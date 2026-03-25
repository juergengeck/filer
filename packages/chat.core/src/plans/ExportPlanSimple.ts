/**
 * ExportPlan (Unified Plan System)
 *
 * Simple, platform-agnostic export plan following the new plan system architecture.
 * Exports chat history in various formats (json, markdown, html).
 *
 * This is the NEW simplified version for the Unified Plan System.
 * Uses only ONE.core dependency via constructor injection.
 */

import type { PlanContext } from '@refinio/api/plan-system';
import { NotFoundError } from '@refinio/api/plan-system';

/**
 * Request/Response types (will be defined with Zod schemas in operation-types.ts)
 */
export interface ExportHistoryRequest {
  topicId: string;
  format: 'json' | 'markdown' | 'html';
}

export interface ExportHistoryResponse {
  data: string;
  filename: string;
}

/**
 * Simple message interface for export
 */
interface Message {
  messageId: string;
  content: string;
  author: string;
  timestamp: number;
  attachments?: string[];
}

/**
 * ExportPlan - Export chat history in various formats
 *
 * Platform-agnostic plan that works identically through all transports.
 */
export class ExportPlanSimple {
  constructor(private oneCore: any) {}

  /**
   * Export topic history in specified format
   *
   * @param request - Export parameters
   * @param context - Optional plan context (auth, tracking)
   * @returns Export data and suggested filename
   */
  async exportHistory(
    request: ExportHistoryRequest,
    context?: PlanContext
  ): Promise<ExportHistoryResponse> {
    const { topicId, format } = request;

    // Get topic from ONE.core
    const topic = await this.getTopic(topicId);
    if (!topic) {
      throw new NotFoundError('Topic', topicId);
    }

    // Get messages for topic
    const messages = await this.getMessages(topicId);

    // Format based on requested format
    let data: string;
    let extension: string;

    switch (format) {
      case 'json':
        data = this.formatAsJson(messages);
        extension = 'json';
        break;

      case 'markdown':
        data = this.formatAsMarkdown(messages, topic);
        extension = 'md';
        break;

      case 'html':
        data = this.formatAsHtml(messages, topic);
        extension = 'html';
        break;

      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    const filename = `export-${topicId.substring(0, 8)}-${Date.now()}.${extension}`;

    return { data, filename };
  }

  /**
   * Get topic by ID (placeholder - implement with actual ONE.core calls)
   */
  private async getTopic(topicId: string): Promise<any> {
    // TODO: Implement actual topic retrieval from ONE.core
    // For now, return mock data for development
    console.warn('[ExportPlan] Using mock topic - implement with real ONE.core');
    return {
      id: topicId,
      name: 'Sample Topic'
    };
  }

  /**
   * Get messages for topic (placeholder - implement with actual ONE.core calls)
   */
  private async getMessages(topicId: string): Promise<Message[]> {
    // TODO: Implement actual message retrieval from ONE.core
    // For now, return mock data for development
    console.warn('[ExportPlan] Using mock messages - implement with real ONE.core');
    return [
      {
        messageId: 'msg-001',
        content: 'Hello, this is a test message',
        author: 'Alice',
        timestamp: Date.now() - 3600000
      },
      {
        messageId: 'msg-002',
        content: 'This is another message',
        author: 'Bob',
        timestamp: Date.now() - 1800000
      },
      {
        messageId: 'msg-003',
        content: 'Final test message',
        author: 'Alice',
        timestamp: Date.now()
      }
    ];
  }

  /**
   * Format messages as JSON
   */
  private formatAsJson(messages: Message[]): string {
    return JSON.stringify(messages, null, 2);
  }

  /**
   * Format messages as Markdown
   */
  private formatAsMarkdown(messages: Message[], topic: any): string {
    const topicName = topic.displayName ?? topic.originalName ?? 'Chat Export';
    let markdown = `# ${topicName}\n\n`;
    markdown += `Exported: ${new Date().toISOString()}\n\n`;
    markdown += `---\n\n`;

    for (const msg of messages) {
      const date = new Date(msg.timestamp).toLocaleString();
      markdown += `## ${msg.author} - ${date}\n\n`;
      markdown += `${msg.content}\n\n`;

      if (msg.attachments && msg.attachments.length > 0) {
        markdown += `**Attachments**: ${msg.attachments.join(', ')}\n\n`;
      }

      markdown += `---\n\n`;
    }

    return markdown;
  }

  /**
   * Format messages as HTML
   */
  private formatAsHtml(messages: Message[], topic: any): string {
    const topicName = topic.displayName ?? topic.originalName ?? 'Chat Export';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(topicName)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 {
      margin: 0 0 10px 0;
      color: #333;
    }
    .export-date {
      color: #666;
      font-size: 14px;
    }
    .message {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .message-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .author {
      font-weight: bold;
      color: #007AFF;
    }
    .timestamp {
      color: #666;
    }
    .content {
      color: #333;
      line-height: 1.5;
    }
    .attachments {
      margin-top: 10px;
      padding: 10px;
      background: #f9f9f9;
      border-radius: 4px;
      font-size: 13px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${this.escapeHtml(topicName)}</h1>
    <div class="export-date">Exported: ${new Date().toLocaleString()}</div>
  </div>

  ${messages
    .map(
      (msg) => `
  <div class="message">
    <div class="message-header">
      <span class="author">${this.escapeHtml(msg.author)}</span>
      <span class="timestamp">${new Date(msg.timestamp).toLocaleString()}</span>
    </div>
    <div class="content">${this.escapeHtml(msg.content)}</div>
    ${
      msg.attachments && msg.attachments.length > 0
        ? `<div class="attachments">Attachments: ${msg.attachments.map((a) => this.escapeHtml(a)).join(', ')}</div>`
        : ''
    }
  </div>
  `
    )
    .join('')}
</body>
</html>`;

    return html;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
