/**
 * Send Message Plan - Atomic Plan
 *
 * Platform-agnostic plan for sending messages to conversations.
 * Works through any transport (IPC, HTTP, stdio, React Native).
 *
 * Key features:
 * - Send message to topic/conversation
 * - Validate message content
 * - Store in ONE.core
 * - Post to channel for sync
 * - Pure business logic, zero platform code
 *
 * Usage:
 * ```typescript
 * const plan = new SendMessagePlan(nodeOneCore);
 * const result = await plan.sendMessage({
 *   topicId: 'topic-123',
 *   content: 'Hello, world!'
 * }, context);
 * ```
 */

import type { PlanContext } from '@refinio/api/types/context';

/**
 * Send Message Request
 */
export interface SendMessageRequest {
    /** Topic/conversation ID to send message to */
    topicId: string;

    /** Message content (text) */
    content: string;

    /** Optional attachments (future) */
    attachments?: string[];

    /** Optional reply-to message ID */
    replyTo?: string;
}

/**
 * Send Message Response
 */
export interface SendMessageResponse {
    /** Created message ID */
    messageId: string;

    /** Timestamp of message creation */
    timestamp: string;

    /** Topic ID the message was sent to */
    topicId: string;
}

/**
 * Send Message Plan
 *
 * Atomic plan for sending messages.
 */
export class SendMessagePlan {
    constructor(private nodeOneCore: any) {}

    /**
     * Send a message to a conversation
     */
    async sendMessage(
        request: SendMessageRequest,
        context: PlanContext
    ): Promise<SendMessageResponse> {
        // Validate request
        if (!request.topicId || !request.topicId.trim()) {
            throw new Error('Topic ID is required');
        }

        if (!request.content || !request.content.trim()) {
            throw new Error('Message content is required');
        }

        // In real implementation, this would:
        // 1. Create message object with ONE.core
        // 2. Store as versioned object
        // 3. Post to channel for P2P sync
        // 4. Emit to local subscribers

        // Mock implementation for demonstration
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();

        // Simulate async operation
        await this.simulateDelay(50);

        // In real code:
        // const message = {
        //   $type$: 'Message',
        //   id: messageId,
        //   topicId: request.topicId,
        //   content: request.content,
        //   sender: context.userId,
        //   timestamp,
        //   replyTo: request.replyTo
        // };
        //
        // const result = await storeVersionedObject(message);
        // await channelManager.postToChannel(request.topicId, message);

        return {
            messageId,
            timestamp,
            topicId: request.topicId
        };
    }

    /**
     * Simulate async delay (for demonstration)
     */
    private async simulateDelay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
