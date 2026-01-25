/**
 * Document Management Routes
 *
 * Handles document storage using R2 with D1 metadata indexing
 */

import { DocumentStorageService } from "../../services/DocumentStorageService.js";

export function registerDocumentRoutes(app) {
  /**
   * Upload a document
   * POST /api/v1/documents/upload
   */
  app.post("/api/v1/documents/upload", async (c) => {
    try {
      const chittyId = c.req.header("X-ChittyID");

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      // Parse multipart form data
      const formData = await c.req.formData();
      const file = formData.get("file");
      const type = formData.get("type") || "misc";
      const metadata = JSON.parse(formData.get("metadata") || "{}");

      if (!file) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_FILE",
              message: "File is required",
            },
          },
          400,
        );
      }

      // Initialize document storage service
      const docService = new DocumentStorageService(c.env);

      // Upload to R2
      const document = await docService.uploadDocument({
        data: await file.arrayBuffer(),
        chittyId,
        type,
        fileName: file.name,
        mimeType: file.type,
        metadata,
      });

      // Log upload in ContextConsciousness™
      if (c.env.CONTEXT_CONSCIOUSNESS) {
        await c.env.CONTEXT_CONSCIOUSNESS.addDecision(chittyId, {
          type: "document_uploaded",
          documentId: document.documentId,
          reasoning: `Document ${file.name} uploaded to ${type}`,
          confidence: 1.0,
          context: { fileName: file.name, type, size: file.size },
        });
      }

      return c.json({
        success: true,
        data: document,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        },
      });
    } catch (error) {
      console.error("[Documents] Upload error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "UPLOAD_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Download a document
   * GET /api/v1/documents/:documentId/download
   */
  app.get("/api/v1/documents/:documentId/download", async (c) => {
    try {
      const documentId = c.req.param("documentId");
      const chittyId = c.req.header("X-ChittyID");
      const token = c.req.query("token"); // Optional presigned URL token

      // Verify access either via ChittyID header or token
      let verifiedChittyId = chittyId;

      if (token && !chittyId) {
        // Verify token and get ChittyID
        const docService = new DocumentStorageService(c.env);
        const tokenData = await docService.verifyAccessToken(token);

        if (!tokenData || tokenData.documentId !== documentId) {
          return c.json(
            {
              success: false,
              error: {
                code: "INVALID_TOKEN",
                message: "Invalid or expired access token",
              },
            },
            401,
          );
        }

        verifiedChittyId = tokenData.chittyId;
      }

      if (!verifiedChittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "X-ChittyID header or valid token required",
            },
          },
          401,
        );
      }

      const docService = new DocumentStorageService(c.env);
      const object = await docService.downloadDocument(
        documentId,
        verifiedChittyId,
      );

      if (!object) {
        return c.json(
          {
            success: false,
            error: {
              code: "DOCUMENT_NOT_FOUND",
              message: "Document not found",
            },
          },
          404,
        );
      }

      // Return the file with appropriate headers
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata.contentType,
          "Content-Disposition": object.httpMetadata.contentDisposition,
          "Content-Length": object.size,
          ETag: object.etag,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      console.error("[Documents] Download error:", error);

      if (error.message.includes("Unauthorized")) {
        return c.json(
          {
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Access denied",
            },
          },
          403,
        );
      }

      return c.json(
        {
          success: false,
          error: {
            code: "DOWNLOAD_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Get document metadata
   * GET /api/v1/documents/:documentId
   */
  app.get("/api/v1/documents/:documentId", async (c) => {
    try {
      const documentId = c.req.param("documentId");

      const docService = new DocumentStorageService(c.env);
      const metadata = await docService.getDocumentMetadata(documentId);

      if (!metadata) {
        return c.json(
          {
            success: false,
            error: {
              code: "DOCUMENT_NOT_FOUND",
              message: "Document not found",
            },
          },
          404,
        );
      }

      return c.json({
        success: true,
        data: metadata,
      });
    } catch (error) {
      console.error("[Documents] Get metadata error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "METADATA_GET_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Generate presigned URL for document access
   * POST /api/v1/documents/:documentId/presigned-url
   */
  app.post("/api/v1/documents/:documentId/presigned-url", async (c) => {
    try {
      const documentId = c.req.param("documentId");
      const chittyId = c.req.header("X-ChittyID");
      const { expiresIn = 3600 } = await c.req.json().catch(() => ({}));

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      const docService = new DocumentStorageService(c.env);
      const url = await docService.getPresignedUrl(
        documentId,
        chittyId,
        expiresIn,
      );

      return c.json({
        success: true,
        data: {
          url,
          expiresIn,
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        },
      });
    } catch (error) {
      console.error("[Documents] Presigned URL error:", error);

      if (error.message.includes("Unauthorized")) {
        return c.json(
          {
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Access denied",
            },
          },
          403,
        );
      }

      return c.json(
        {
          success: false,
          error: {
            code: "PRESIGNED_URL_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * List documents for a ChittyID
   * GET /api/v1/documents
   */
  app.get("/api/v1/documents", async (c) => {
    try {
      const chittyId = c.req.header("X-ChittyID");
      const type = c.req.query("type");
      const caseId = c.req.query("caseId");
      const limit = parseInt(c.req.query("limit") || "50");

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      const docService = new DocumentStorageService(c.env);
      const documents = await docService.listDocuments(chittyId, {
        type,
        caseId,
        limit,
      });

      return c.json({
        success: true,
        data: {
          count: documents.length,
          documents,
        },
      });
    } catch (error) {
      console.error("[Documents] List error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "LIST_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Search documents
   * GET /api/v1/documents/search
   */
  app.get("/api/v1/documents/search", async (c) => {
    try {
      const chittyId = c.req.header("X-ChittyID");
      const query = c.req.query("q");

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      if (!query) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_QUERY",
              message: "Search query (q) is required",
            },
          },
          400,
        );
      }

      const docService = new DocumentStorageService(c.env);
      const documents = await docService.searchDocuments(chittyId, query);

      return c.json({
        success: true,
        data: {
          query,
          count: documents.length,
          documents,
        },
      });
    } catch (error) {
      console.error("[Documents] Search error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "SEARCH_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Delete a document
   * DELETE /api/v1/documents/:documentId
   */
  app.delete("/api/v1/documents/:documentId", async (c) => {
    try {
      const documentId = c.req.param("documentId");
      const chittyId = c.req.header("X-ChittyID");

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      const docService = new DocumentStorageService(c.env);
      await docService.deleteDocument(documentId, chittyId);

      return c.json({
        success: true,
        data: {
          documentId,
          deleted: true,
        },
      });
    } catch (error) {
      console.error("[Documents] Delete error:", error);

      if (error.message.includes("Unauthorized")) {
        return c.json(
          {
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Access denied",
            },
          },
          403,
        );
      }

      return c.json(
        {
          success: false,
          error: {
            code: "DELETE_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Get storage statistics
   * GET /api/v1/documents/stats
   */
  app.get("/api/v1/documents/stats", async (c) => {
    try {
      const chittyId = c.req.header("X-ChittyID");

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      const docService = new DocumentStorageService(c.env);
      const stats = await docService.getStorageStats(chittyId);

      return c.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("[Documents] Stats error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "STATS_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Create multipart upload for large files
   * POST /api/v1/documents/multipart/create
   */
  app.post("/api/v1/documents/multipart/create", async (c) => {
    try {
      const chittyId = c.req.header("X-ChittyID");
      const { fileName, mimeType, type } = await c.req.json();

      if (!chittyId) {
        return c.json(
          {
            success: false,
            error: {
              code: "MISSING_CHITTYID",
              message: "X-ChittyID header is required",
            },
          },
          400,
        );
      }

      const docService = new DocumentStorageService(c.env);
      const upload = await docService.createMultipartUpload({
        chittyId,
        type,
        fileName,
        mimeType,
      });

      return c.json({
        success: true,
        data: upload,
      });
    } catch (error) {
      console.error("[Documents] Multipart create error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "MULTIPART_CREATE_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });

  /**
   * Upload a part of multipart upload
   * PUT /api/v1/documents/multipart/:uploadId/part/:partNumber
   */
  app.put(
    "/api/v1/documents/multipart/:uploadId/part/:partNumber",
    async (c) => {
      try {
        const uploadId = c.req.param("uploadId");
        const partNumber = parseInt(c.req.param("partNumber"));
        const data = await c.req.arrayBuffer();

        const docService = new DocumentStorageService(c.env);
        const uploadedPart = await docService.uploadPart(
          uploadId,
          partNumber,
          data,
        );

        return c.json({
          success: true,
          data: uploadedPart,
        });
      } catch (error) {
        console.error("[Documents] Upload part error:", error);
        return c.json(
          {
            success: false,
            error: {
              code: "UPLOAD_PART_FAILED",
              message: error.message,
            },
          },
          500,
        );
      }
    },
  );

  /**
   * Complete multipart upload
   * POST /api/v1/documents/multipart/:uploadId/complete
   */
  app.post("/api/v1/documents/multipart/:uploadId/complete", async (c) => {
    try {
      const uploadId = c.req.param("uploadId");
      const { parts } = await c.req.json();

      const docService = new DocumentStorageService(c.env);
      const document = await docService.completeMultipartUpload(
        uploadId,
        parts,
      );

      return c.json({
        success: true,
        data: document,
      });
    } catch (error) {
      console.error("[Documents] Complete multipart error:", error);
      return c.json(
        {
          success: false,
          error: {
            code: "COMPLETE_MULTIPART_FAILED",
            message: error.message,
          },
        },
        500,
      );
    }
  });
}
