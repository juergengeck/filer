/**
 * Feed-Forward Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for feed-forward knowledge sharing operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Wraps FeedForwardManager with standardized request/response interfaces.
 */

// Request/Response interfaces
export interface CreateSupplyRequest {
  keywords: string[];
  contextLevel: number;
  conversationId: string;
  metadata?: any;
}

export interface CreateSupplyResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export interface CreateDemandRequest {
  keywords: string[];
  urgency: number;
  context: string;
  criteria?: any;
  expires?: number;
  maxResults?: number;
}

export interface CreateDemandResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export interface MatchSupplyDemandRequest {
  demandHash: string;
  minTrust?: number;
  limit?: number;
}

export interface MatchSupplyDemandResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export interface UpdateTrustRequest {
  participantId: string;
  adjustment: number;
  reason: string;
  evidence?: any;
}

export interface UpdateTrustResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export interface GetCorpusStreamRequest {
  since?: number;
  minQuality?: number;
  keywords?: string[];
}

export interface GetCorpusStreamResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export interface EnableSharingRequest {
  conversationId: string;
  enabled: boolean;
  retroactive?: boolean;
}

export interface EnableSharingResponse {
  success: boolean;
  error?: string;
  data?: any;
}

export interface GetTrustScoreRequest {
  participantId: string;
}

export interface GetTrustScoreResponse {
  success: boolean;
  error?: string;
  trustScore?: number;
  data?: any;
}

/**
 * FeedForwardPlan - Pure business logic for feed-forward operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - feedForwardManager: Platform-specific FeedForwardManager instance
 */
export class FeedForwardPlan {
  private feedForwardManager: any;

  constructor(feedForwardManager: any) {
    this.feedForwardManager = feedForwardManager;
  }

  /**
   * Create Supply object for knowledge sharing
   */
  async createSupply(request: CreateSupplyRequest): Promise<CreateSupplyResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.createSupply(request);
      return result;
    } catch (error) {
      console.error('[FeedForwardPlan] Error creating supply:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating supply'
      };
    }
  }

  /**
   * Create Demand object for knowledge needs
   */
  async createDemand(request: CreateDemandRequest): Promise<CreateDemandResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.createDemand(request);
      return result;
    } catch (error) {
      console.error('[FeedForwardPlan] Error creating demand:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating demand'
      };
    }
  }

  /**
   * Match Supply with Demand based on keywords and trust
   */
  async matchSupplyDemand(request: MatchSupplyDemandRequest): Promise<MatchSupplyDemandResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.matchSupplyDemand(request);
      return result;
    } catch (error) {
      console.error('[FeedForwardPlan] Error matching supply/demand:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error matching supply/demand'
      };
    }
  }

  /**
   * Update trust score for a participant
   */
  async updateTrust(request: UpdateTrustRequest): Promise<UpdateTrustResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.updateTrust(request);
      return result;
    } catch (error) {
      console.error('[FeedForwardPlan] Error updating trust:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error updating trust'
      };
    }
  }

  /**
   * Get corpus stream of available knowledge
   */
  async getCorpusStream(request: GetCorpusStreamRequest = {}): Promise<GetCorpusStreamResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.getCorpusStream(request);
      return result;
    } catch (error) {
      console.error('[FeedForwardPlan] Error getting corpus stream:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting corpus stream'
      };
    }
  }

  /**
   * Enable or disable sharing for a conversation
   */
  async enableSharing(request: EnableSharingRequest): Promise<EnableSharingResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.enableSharing(request);
      return result;
    } catch (error) {
      console.error('[FeedForwardPlan] Error updating sharing:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error updating sharing'
      };
    }
  }

  /**
   * Get trust score for a participant
   */
  async getTrustScore(request: GetTrustScoreRequest): Promise<GetTrustScoreResponse> {
    if (!this.feedForwardManager) {
      return { success: false, error: 'Feed-forward manager not initialized' };
    }

    try {
      const result = await this.feedForwardManager.getTrustScore(request.participantId);
      return { success: true, ...result };
    } catch (error) {
      console.error('[FeedForwardPlan] Error getting trust score:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting trust score'
      };
    }
  }
}
