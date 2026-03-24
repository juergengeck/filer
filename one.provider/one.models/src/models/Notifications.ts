// Pseudo implementation, did not compile it
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {OEvent} from '../misc/OEvent.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type {RawChannelEntry} from './ChannelManager.js';
import type ChannelManager from './ChannelManager.js';

export default class Notifications {
    private notificationCounters = new Map<string, number>();

    // Without arguments, this is just to force a rerender of the UI component, not to get the new notification count
    private onNewNotification = new OEvent<() => undefined>();

    constructor(channelManager: ChannelManager) {
        channelManager.onUpdated(
            (
                _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
                channelId: string,
                _channelOwner: SHA256IdHash<Person> | null,
                _timeOfEarliestChange: Date,
                _data: RawChannelEntry[]
            ) => {
                this.increaseNotificatioinCountForTopic(channelId);
            }
        );
    }

    /**
     * Get the notification count for a topic
     *
     * @param topicId
     */
    getNotificationCountForTopic(topicId: string): number {
        return this.notificationCounters.get(topicId) || 0;
    }

    /**
     * Call this when you read all messages in a topic.
     *
     * @param topicId
     */
    resetNotificatioinCountForTopic(topicId: string): void {
        this.notificationCounters.delete(topicId);
        this.onNewNotification.emit();
    }

    private increaseNotificatioinCountForTopic(topicId: string): void {
        this.notificationCounters.set(topicId, this.getNotificationCountForTopic(topicId) + 1);
        this.onNewNotification.emit();
    }
}
