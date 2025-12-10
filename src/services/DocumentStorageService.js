/**
 * DocumentStorageService - R2-based document storage for ChittyConnect
 *
 * Manages document storage for evidence, case files, and attachments
 * with metadata indexing in D1 and CDN caching support.
 *
 * Storage Structure:
 * - chittyid/{chittyId}/evidence/{documentId}
 * - chittyid/{chittyId}/cases/{caseId}/{documentId}
 * - chittyid/{chittyId}/attachments/{documentId}
 * - shared/templates/{templateId}
 */

export class DocumentStorageService {
  constructor(env) {
    this.env = env;
    this.bucket = env.DOCUMENT_STORAGE; // R2 bucket binding
  }

  /**
   * Upload a document to R2
   *
   * @param {object} options - Upload options
   * @param {ArrayBuffer|ReadableStream} options.data - Document data
   * @param {string} options.chittyId - ChittyID of owner
   * @param {string} options.type - Document type (evidence, case_file, attachment)
   * @param {string} options.fileName - Original filename
   * @param {string} options.mimeType - MIME type
   * @param {object} options.metadata - Custom metadata
   * @returns {Promise<object>} Document record
   */
  async uploadDocument({
    data,
    chittyId,
    type,
    fileName,
    mimeType,
    metadata = {}
  }) {
    const documentId = crypto.randomUUID();
    const timestamp = Date.now();

    // Build storage path
    const path = this.buildStoragePath(chittyId, type, documentId);

    try {
      // Calculate file size
      let size = 0;
      if (data instanceof ArrayBuffer) {
        size = data.byteLength;
      } else if (data instanceof ReadableStream) {
        // For streams, we'll get size from metadata if available
        size = metadata.size || 0;
      }

      // Upload to R2 with custom metadata
      await this.bucket.put(path, data, {
        httpMetadata: {
          contentType: mimeType,
          contentDisposition: `attachment; filename="${fileName}"`
        },
        customMetadata: {
          chittyId,
          documentId,
          type,
          fileName,
          uploadedAt: timestamp.toString(),
          ...metadata
        }
      });

      // Store metadata in D1 for searching/indexing
      const dbRecord = await this.createDocumentRecord({
        documentId,
        chittyId,
        type,
        fileName,
        mimeType,
        size,
        storagePath: path,
        metadata,
        uploadedAt: timestamp
      });

      console.log(`[DocumentStorage] Uploaded: ${path} (${size} bytes)`);

      return dbRecord;
    } catch (error) {
      console.error('[DocumentStorage] Upload error:', error);
      throw new Error(`Failed to upload document: ${error.message}`);
    }
  }

  /**
   * Download a document from R2
   *
   * @param {string} documentId - Document ID
   * @param {string} chittyId - ChittyID for authorization
   * @returns {Promise<R2Object|null>} R2 object with data
   */
  async downloadDocument(documentId, chittyId) {
    try {
      // Get metadata from D1 first
      const record = await this.getDocumentRecord(documentId);

      if (!record) {
        throw new Error('Document not found');
      }

      // Verify ownership
      if (record.chitty_id !== chittyId) {
        throw new Error('Unauthorized: Document belongs to different ChittyID');
      }

      // Get from R2
      const object = await this.bucket.get(record.storage_path);

      if (!object) {
        throw new Error('Document not found in storage');
      }

      // Update access metrics
      await this.updateAccessMetrics(documentId);

      return object;
    } catch (error) {
      console.error('[DocumentStorage] Download error:', error);
      throw error;
    }
  }

  /**
   * Generate a presigned URL for document access
   *
   * @param {string} documentId - Document ID
   * @param {string} chittyId - ChittyID for authorization
   * @param {number} expiresIn - URL validity in seconds (default 3600)
   * @returns {Promise<string>} Presigned URL
   */
  async getPresignedUrl(documentId, chittyId, expiresIn = 3600) {
    try {
      // Get metadata from D1
      const record = await this.getDocumentRecord(documentId);

      if (!record) {
        throw new Error('Document not found');
      }

      // Verify ownership
      if (record.chitty_id !== chittyId) {
        throw new Error('Unauthorized');
      }

      // Generate presigned URL using R2's signed URL capability
      // Note: R2 doesn't support presigned URLs natively yet, so we'll use a token-based approach
      const token = await this.generateAccessToken(documentId, chittyId, expiresIn);

      // Build URL through our API with the token
      const baseUrl = this.env.CHITTYCONNECT_URL || 'https://connect.chitty.cc';
      return `${baseUrl}/api/v1/documents/${documentId}/download?token=${token}`;
    } catch (error) {
      console.error('[DocumentStorage] Presigned URL error:', error);
      throw error;
    }
  }

  /**
   * List documents for a ChittyID
   *
   * @param {string} chittyId - ChittyID
   * @param {object} filters - Optional filters
   * @returns {Promise<Array>} Document records
   */
  async listDocuments(chittyId, filters = {}) {
    try {
      let query = `
        SELECT
          document_id,
          type,
          file_name,
          mime_type,
          size,
          storage_path,
          metadata,
          uploaded_at,
          last_accessed,
          access_count
        FROM documents
        WHERE chitty_id = ?
      `;

      const params = [chittyId];

      // Apply filters
      if (filters.type) {
        query += ' AND type = ?';
        params.push(filters.type);
      }

      if (filters.caseId) {
        query += ' AND storage_path LIKE ?';
        params.push(`%/cases/${filters.caseId}/%`);
      }

      query += ' ORDER BY uploaded_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const result = await this.env.DB.prepare(query)
        .bind(...params)
        .all();

      return result.results || [];
    } catch (error) {
      console.error('[DocumentStorage] List error:', error);
      return [];
    }
  }

  /**
   * Delete a document
   *
   * @param {string} documentId - Document ID
   * @param {string} chittyId - ChittyID for authorization
   * @returns {Promise<boolean>} Success status
   */
  async deleteDocument(documentId, chittyId) {
    try {
      // Get metadata from D1
      const record = await this.getDocumentRecord(documentId);

      if (!record) {
        throw new Error('Document not found');
      }

      // Verify ownership
      if (record.chitty_id !== chittyId) {
        throw new Error('Unauthorized');
      }

      // Delete from R2
      await this.bucket.delete(record.storage_path);

      // Delete metadata from D1
      await this.env.DB.prepare(`
        DELETE FROM documents WHERE document_id = ?
      `).bind(documentId).run();

      console.log(`[DocumentStorage] Deleted: ${record.storage_path}`);

      return true;
    } catch (error) {
      console.error('[DocumentStorage] Delete error:', error);
      throw error;
    }
  }

  /**
   * Get document metadata
   *
   * @param {string} documentId - Document ID
   * @returns {Promise<object|null>} Document record
   */
  async getDocumentMetadata(documentId) {
    try {
      const record = await this.getDocumentRecord(documentId);

      if (!record) {
        return null;
      }

      // Parse metadata JSON
      return {
        documentId: record.document_id,
        chittyId: record.chitty_id,
        type: record.type,
        fileName: record.file_name,
        mimeType: record.mime_type,
        size: record.size,
        uploadedAt: record.uploaded_at,
        lastAccessed: record.last_accessed,
        accessCount: record.access_count,
        metadata: JSON.parse(record.metadata || '{}')
      };
    } catch (error) {
      console.error('[DocumentStorage] Get metadata error:', error);
      return null;
    }
  }

  /**
   * Search documents by content or metadata
   *
   * @param {string} chittyId - ChittyID
   * @param {string} searchQuery - Search query
   * @returns {Promise<Array>} Matching documents
   */
  async searchDocuments(chittyId, searchQuery) {
    try {
      const result = await this.env.DB.prepare(`
        SELECT
          document_id,
          type,
          file_name,
          mime_type,
          size,
          metadata,
          uploaded_at,
          last_accessed
        FROM documents
        WHERE chitty_id = ?
          AND (
            file_name LIKE ?
            OR metadata LIKE ?
          )
        ORDER BY uploaded_at DESC
        LIMIT 50
      `).bind(
        chittyId,
        `%${searchQuery}%`,
        `%${searchQuery}%`
      ).all();

      return result.results || [];
    } catch (error) {
      console.error('[DocumentStorage] Search error:', error);
      return [];
    }
  }

  /**
   * Get storage statistics for a ChittyID
   *
   * @param {string} chittyId - ChittyID
   * @returns {Promise<object>} Storage stats
   */
  async getStorageStats(chittyId) {
    try {
      const result = await this.env.DB.prepare(`
        SELECT
          COUNT(*) as total_documents,
          SUM(size) as total_size,
          COUNT(CASE WHEN type = 'evidence' THEN 1 END) as evidence_count,
          COUNT(CASE WHEN type = 'case_file' THEN 1 END) as case_file_count,
          COUNT(CASE WHEN type = 'attachment' THEN 1 END) as attachment_count
        FROM documents
        WHERE chitty_id = ?
      `).bind(chittyId).first();

      return {
        totalDocuments: result.total_documents || 0,
        totalSize: result.total_size || 0,
        totalSizeFormatted: this.formatBytes(result.total_size || 0),
        evidenceCount: result.evidence_count || 0,
        caseFileCount: result.case_file_count || 0,
        attachmentCount: result.attachment_count || 0
      };
    } catch (error) {
      console.error('[DocumentStorage] Stats error:', error);
      return {
        totalDocuments: 0,
        totalSize: 0,
        totalSizeFormatted: '0 B'
      };
    }
  }

  /**
   * Copy document to another location
   *
   * @param {string} sourceDocumentId - Source document ID
   * @param {string} chittyId - ChittyID for authorization
   * @param {string} destinationType - New type
   * @returns {Promise<object>} New document record
   */
  async copyDocument(sourceDocumentId, chittyId, destinationType) {
    try {
      // Get source document
      const sourceRecord = await this.getDocumentRecord(sourceDocumentId);

      if (!sourceRecord || sourceRecord.chitty_id !== chittyId) {
        throw new Error('Unauthorized or document not found');
      }

      // Get object from R2
      const sourceObject = await this.bucket.get(sourceRecord.storage_path);

      if (!sourceObject) {
        throw new Error('Source document not found in storage');
      }

      // Upload to new location
      const newDocument = await this.uploadDocument({
        data: sourceObject.body,
        chittyId,
        type: destinationType,
        fileName: sourceRecord.file_name,
        mimeType: sourceRecord.mime_type,
        metadata: JSON.parse(sourceRecord.metadata || '{}')
      });

      return newDocument;
    } catch (error) {
      console.error('[DocumentStorage] Copy error:', error);
      throw error;
    }
  }

  // ============ Helper Methods ============

  /**
   * Build storage path for a document
   */
  buildStoragePath(chittyId, type, documentId) {
    const sanitizedId = chittyId.replace(/[^a-zA-Z0-9-]/g, '_');

    switch (type) {
      case 'evidence':
        return `chittyid/${sanitizedId}/evidence/${documentId}`;
      case 'case_file':
        return `chittyid/${sanitizedId}/cases/${documentId}`;
      case 'attachment':
        return `chittyid/${sanitizedId}/attachments/${documentId}`;
      case 'template':
        return `shared/templates/${documentId}`;
      default:
        return `chittyid/${sanitizedId}/misc/${documentId}`;
    }
  }

  /**
   * Create document record in D1
   */
  async createDocumentRecord(record) {
    await this.env.DB.prepare(`
      INSERT INTO documents (
        document_id, chitty_id, type, file_name, mime_type,
        size, storage_path, metadata, uploaded_at,
        last_accessed, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.documentId,
      record.chittyId,
      record.type,
      record.fileName,
      record.mimeType,
      record.size,
      record.storagePath,
      JSON.stringify(record.metadata),
      record.uploadedAt,
      null,
      0
    ).run();

    return {
      documentId: record.documentId,
      chittyId: record.chittyId,
      type: record.type,
      fileName: record.fileName,
      mimeType: record.mimeType,
      size: record.size,
      storagePath: record.storagePath,
      uploadedAt: record.uploadedAt
    };
  }

  /**
   * Get document record from D1
   */
  async getDocumentRecord(documentId) {
    return await this.env.DB.prepare(`
      SELECT * FROM documents WHERE document_id = ?
    `).bind(documentId).first();
  }

  /**
   * Update access metrics
   */
  async updateAccessMetrics(documentId) {
    await this.env.DB.prepare(`
      UPDATE documents
      SET
        last_accessed = ?,
        access_count = access_count + 1
      WHERE document_id = ?
    `).bind(Date.now(), documentId).run();
  }

  /**
   * Generate access token for presigned URL
   */
  async generateAccessToken(documentId, chittyId, expiresIn) {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + (expiresIn * 1000);

    // Store in KV with expiration
    await this.env.TOKEN_KV.put(
      `doc_token:${token}`,
      JSON.stringify({ documentId, chittyId, expiresAt }),
      { expirationTtl: expiresIn }
    );

    return token;
  }

  /**
   * Verify access token
   */
  async verifyAccessToken(token) {
    const data = await this.env.TOKEN_KV.get(`doc_token:${token}`, { type: 'json' });

    if (!data) {
      return null;
    }

    if (data.expiresAt < Date.now()) {
      return null;
    }

    return data;
  }

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Multipart upload for large files (>5MB)
   *
   * @param {object} options - Upload options
   * @returns {Promise<object>} Upload session
   */
  async createMultipartUpload(options) {
    const uploadId = crypto.randomUUID();
    const path = this.buildStoragePath(options.chittyId, options.type, uploadId);

    // R2 multipart upload
    const multipartUpload = await this.bucket.createMultipartUpload(path, {
      httpMetadata: {
        contentType: options.mimeType
      },
      customMetadata: {
        chittyId: options.chittyId,
        fileName: options.fileName,
        type: options.type
      }
    });

    return {
      uploadId: multipartUpload.uploadId,
      documentId: uploadId,
      path,
      key: multipartUpload.key
    };
  }

  /**
   * Upload a part of a multipart upload
   */
  async uploadPart(uploadId, partNumber, data) {
    const record = await this.getDocumentRecord(uploadId);

    if (!record) {
      throw new Error('Upload session not found');
    }

    const uploadedPart = await this.bucket.uploadPart(
      record.storage_path,
      uploadId,
      partNumber,
      data
    );

    return uploadedPart;
  }

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(uploadId, parts) {
    const record = await this.getDocumentRecord(uploadId);

    if (!record) {
      throw new Error('Upload session not found');
    }

    await this.bucket.completeMultipartUpload(
      record.storage_path,
      uploadId,
      parts
    );

    return record;
  }
}

export default DocumentStorageService;