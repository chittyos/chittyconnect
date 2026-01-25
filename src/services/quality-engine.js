/**
 * ChittyQuality Engine
 * Document quality validation and quality gate system
 */

// ============================================================================
// VALIDATION RULES
// ============================================================================

export const QualityRules = {
  draftPatterns: [
    /draft/i,
    /\(draft\)/i,
    /v\d+\.\d+/i,
    /temp/i,
    /test/i,
    /scratch/i,
    /untitled/i,
    /copy of/i,
    /- Copy/i,
    /\d{8}_/,
    /\(1\)/i,
    /\(2\)/i,
    /wip/i,
    /todo/i,
    /notes/i,
  ],
  junkContentPatterns: [
    /lorem ipsum/i,
    /test test test/i,
    /asdfasdf/i,
    /\[INSERT .+\]/i,
    /\[TODO\]/i,
    /\[TK\]/i,
  ],
  minimumContentLength: 100,
  minimumWords: 20,
  minimumFileSize: 1024,
  maximumFileSize: 50000000,
  incompletePatterns: [
    /\[REDACTED\]/i,
    /\[CLIENT NAME\]/i,
    /\[DATE\]/i,
    /\[JURISDICTION\]/i,
    /YOUR NAME HERE/i,
    /\{\{.+\}\}/,
  ],
};

// ============================================================================
// VALIDATION ENGINE CLASS
// ============================================================================

export class ChittyQualityEngine {
  async validateDocument(file) {
    const issues = [];
    const metadata = this.extractMetadata(file);

    issues.push(...this.checkNamingPatterns(file.name));
    issues.push(...this.checkFileSize(file.size));
    issues.push(...this.checkContentQuality(file.content));
    issues.push(...this.checkCompleteness(file.content));

    const { confidence, recommendation, reasoning } =
      this.calculateRecommendation(issues);

    return {
      passed: recommendation === "approve",
      confidence,
      issues,
      metadata,
      recommendation,
      reasoning,
    };
  }

  checkNamingPatterns(filename) {
    const issues = [];

    for (const pattern of QualityRules.draftPatterns) {
      if (pattern.test(filename)) {
        issues.push({
          type: "draft_indicator",
          severity: filename.match(/draft|wip|test/i) ? "critical" : "warning",
          description: `Filename contains draft/temporary indicator: "${pattern.source}"`,
          pattern: pattern.source,
        });
      }
    }

    return issues;
  }

  checkFileSize(size) {
    const issues = [];

    if (size < QualityRules.minimumFileSize) {
      issues.push({
        type: "size_limit",
        severity: "critical",
        description: `File too small (${size} bytes)`,
      });
    }

    if (size > QualityRules.maximumFileSize) {
      issues.push({
        type: "size_limit",
        severity: "critical",
        description: `File too large (${size} bytes)`,
      });
    }

    return issues;
  }

  checkContentQuality(content) {
    const issues = [];

    if (content.length < QualityRules.minimumContentLength) {
      issues.push({
        type: "junk_content",
        severity: "critical",
        description: `Content too short (${content.length} chars)`,
      });
    }

    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < QualityRules.minimumWords) {
      issues.push({
        type: "junk_content",
        severity: "critical",
        description: `Too few words (${wordCount})`,
      });
    }

    for (const pattern of QualityRules.junkContentPatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: "junk_content",
          severity: "critical",
          description: `Content contains junk pattern: "${pattern.source}"`,
          pattern: pattern.source,
        });
      }
    }

    const uniqueWords = new Set(content.toLowerCase().split(/\s+/));
    const repetitionRatio = wordCount / uniqueWords.size;
    if (repetitionRatio > 5) {
      issues.push({
        type: "junk_content",
        severity: "warning",
        description: `High repetition ratio (${repetitionRatio.toFixed(2)})`,
      });
    }

    return issues;
  }

  checkCompleteness(content) {
    const issues = [];

    for (const pattern of QualityRules.incompletePatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: "incomplete",
          severity: "critical",
          description: `Content contains placeholder: "${pattern.source}"`,
          pattern: pattern.source,
        });
      }
    }

    return issues;
  }

  extractMetadata(file) {
    const extension = file.name.split(".").pop() || "";
    const wordCount = file.content
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    const hasVersionNumber = /v?\d+\.\d+/.test(file.name);
    const isDraft = QualityRules.draftPatterns.some((p) => p.test(file.name));

    const lines = file.content.split("\n").filter((l) => l.trim());
    const title = lines[0]?.substring(0, 100) || file.name;

    return {
      filename: file.name,
      filesize: file.size,
      extension,
      contentLength: file.content.length,
      wordCount,
      hasVersionNumber,
      isDraft,
      title,
      ...file.metadata,
    };
  }

  calculateRecommendation(issues) {
    const criticalCount = issues.filter(
      (i) => i.severity === "critical",
    ).length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;

    if (criticalCount > 0) {
      const criticalIssues = issues
        .filter((i) => i.severity === "critical")
        .map((i) => i.description)
        .join("; ");

      return {
        confidence: 1.0 - criticalCount * 0.2,
        recommendation: "reject",
        reasoning: `REJECTED: ${criticalCount} critical issue(s) found: ${criticalIssues}`,
      };
    }

    if (warningCount > 2) {
      return {
        confidence: 0.5,
        recommendation: "quarantine",
        reasoning: `QUARANTINE: ${warningCount} warnings require manual review`,
      };
    }

    if (warningCount > 0) {
      return {
        confidence: 0.8,
        recommendation: "quarantine",
        reasoning: `QUARANTINE: ${warningCount} warning(s) - recommend manual review`,
      };
    }

    return {
      confidence: 1.0,
      recommendation: "approve",
      reasoning: "APPROVED: No quality issues detected",
    };
  }
}
