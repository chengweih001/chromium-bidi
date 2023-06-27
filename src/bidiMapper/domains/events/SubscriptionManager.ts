/**
 * Copyright 2022 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  BrowsingContext,
  type CommonDataTypes,
  Log,
  Message,
  Network,
  Script,
  type Session,
} from '../../../protocol/protocol.js';
import type {BrowsingContextStorage} from '../context/browsingContextStorage.js';

/**
 * Returns the cartesian product of the given arrays.
 *
 * Example:
 *   cartesian([1, 2], ['a', 'b']); => [[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']]
 */
export function cartesianProduct(...a: any[][]) {
  return a.reduce((a: unknown[], b: unknown[]) =>
    a.flatMap((d) => b.map((e) => [d, e].flat()))
  );
}

/** Expands "AllEvents" events into atomic events. */
export function unrollEvents(
  events: Session.SubscriptionRequestEvent[]
): Session.SubscriptionRequestEvent[] {
  const allEvents = new Set<Session.SubscriptionRequestEvent>();

  function addEvents(events: Session.SubscriptionRequestEvent[]) {
    for (const event of events) {
      allEvents.add(event);
    }
  }

  for (const event of events) {
    switch (event) {
      case BrowsingContext.AllEvents:
        addEvents(Object.values(BrowsingContext.EventNames));
        break;
      case Log.AllEvents:
        addEvents(Object.values(Log.EventNames));
        break;
      case Network.AllEvents:
        addEvents(Object.values(Network.EventNames));
        break;
      case Script.AllEvents:
        addEvents(Object.values(Script.EventNames));
        break;
      default:
        allEvents.add(event);
    }
  }

  return [...allEvents.values()];
}

export class SubscriptionManager {
  #subscriptionPriority = 0;
  // BrowsingContext `null` means the event has subscription across all the
  // browsing contexts.
  // Channel `null` means no `channel` should be added.
  #channelToContextToEventMap = new Map<
    string | null,
    Map<
      CommonDataTypes.BrowsingContext | null,
      Map<Session.SubscriptionRequestEvent, number>
    >
  >();
  #browsingContextStorage: BrowsingContextStorage;

  constructor(browsingContextStorage: BrowsingContextStorage) {
    this.#browsingContextStorage = browsingContextStorage;
  }

  getChannelsSubscribedToEvent(
    eventMethod: Session.SubscriptionRequestEvent,
    contextId: CommonDataTypes.BrowsingContext | null
  ): (string | null)[] {
    const prioritiesAndChannels = Array.from(
      this.#channelToContextToEventMap.keys()
    )
      .map((channel) => ({
        priority: this.#getEventSubscriptionPriorityForChannel(
          eventMethod,
          contextId,
          channel
        ),
        channel,
      }))
      .filter(({priority}) => priority !== null) as {
      priority: number;
      channel: string | null;
    }[];

    // Sort channels by priority.
    return prioritiesAndChannels
      .sort((a, b) => a.priority - b.priority)
      .map(({channel}) => channel);
  }

  #getEventSubscriptionPriorityForChannel(
    eventMethod: Session.SubscriptionRequestEvent,
    contextId: CommonDataTypes.BrowsingContext | null,
    channel: string | null
  ): null | number {
    const contextToEventMap = this.#channelToContextToEventMap.get(channel);
    if (contextToEventMap === undefined) {
      return null;
    }

    const maybeTopLevelContextId =
      this.#browsingContextStorage.findTopLevelContextId(contextId);

    // `null` covers global subscription.
    const relevantContexts = [...new Set([null, maybeTopLevelContextId])];

    // Get all the subscription priorities.
    const priorities: number[] = relevantContexts
      .map((c) => contextToEventMap.get(c)?.get(eventMethod))
      .filter((p) => p !== undefined) as number[];

    if (priorities.length === 0) {
      // Not subscribed, return null.
      return null;
    }

    // Return minimal priority.
    return Math.min(...priorities);
  }

  subscribe(
    event: Session.SubscriptionRequestEvent,
    contextId: CommonDataTypes.BrowsingContext | null,
    channel: string | null
  ): void {
    // All the subscriptions are handled on the top-level contexts.
    contextId = this.#browsingContextStorage.findTopLevelContextId(contextId);

    if (event === BrowsingContext.AllEvents) {
      Object.values(BrowsingContext.EventNames).map((specificEvent) =>
        this.subscribe(specificEvent, contextId, channel)
      );
      return;
    }
    if (event === Log.AllEvents) {
      Object.values(Log.EventNames).map((specificEvent) =>
        this.subscribe(specificEvent, contextId, channel)
      );
      return;
    }
    if (event === Network.AllEvents) {
      Object.values(Network.EventNames).map((specificEvent) =>
        this.subscribe(specificEvent, contextId, channel)
      );
      return;
    }
    if (event === Script.AllEvents) {
      Object.values(Script.EventNames).map((specificEvent) =>
        this.subscribe(specificEvent, contextId, channel)
      );
      return;
    }

    if (!this.#channelToContextToEventMap.has(channel)) {
      this.#channelToContextToEventMap.set(channel, new Map());
    }
    const contextToEventMap = this.#channelToContextToEventMap.get(channel)!;

    if (!contextToEventMap.has(contextId)) {
      contextToEventMap.set(contextId, new Map());
    }
    const eventMap = contextToEventMap.get(contextId)!;

    // Do not re-subscribe to events to keep the priority.
    if (eventMap.has(event)) {
      return;
    }

    eventMap.set(event, this.#subscriptionPriority++);
  }

  /**
   * Unsubscribes atomically from all events in the given contexts and channel.
   */
  unsubscribeAll(
    events: Session.SubscriptionRequestEvent[],
    contextIds: (CommonDataTypes.BrowsingContext | null)[],
    channel: string | null
  ) {
    // Assert all contexts are known.
    for (const contextId of contextIds) {
      if (contextId !== null) {
        this.#browsingContextStorage.getContext(contextId);
      }
    }

    const eventContextPairs: [
      eventName: Session.SubscriptionRequestEvent,
      contextId: CommonDataTypes.BrowsingContext | null
    ][] = cartesianProduct(unrollEvents(events), contextIds);

    // Assert all unsubscriptions are valid.
    // If any of the unsubscriptions are invalid, do not unsubscribe from anything.
    eventContextPairs
      .map(([event, contextId]) =>
        this.#checkUnsubscribe(event, contextId, channel)
      )
      .forEach((unsubscribe) => unsubscribe());
  }

  /**
   * Unsubscribes from the event in the given context and channel.
   * Syntactic sugar for "unsubscribeAll".
   */
  unsubscribe(
    eventName: Session.SubscriptionRequestEvent,
    contextId: CommonDataTypes.BrowsingContext | null,
    channel: string | null
  ) {
    this.unsubscribeAll([eventName], [contextId], channel);
  }

  #checkUnsubscribe(
    event: Session.SubscriptionRequestEvent,
    contextId: CommonDataTypes.BrowsingContext | null,
    channel: string | null
  ): () => void {
    // All the subscriptions are handled on the top-level contexts.
    contextId = this.#browsingContextStorage.findTopLevelContextId(contextId);

    if (!this.#channelToContextToEventMap.has(channel)) {
      throw new Message.InvalidArgumentException(
        `Cannot unsubscribe from ${event}, ${
          contextId === null ? 'null' : contextId
        }. No subscription found.`
      );
    }
    const contextToEventMap = this.#channelToContextToEventMap.get(channel)!;

    if (!contextToEventMap.has(contextId)) {
      throw new Message.InvalidArgumentException(
        `Cannot unsubscribe from ${event}, ${
          contextId === null ? 'null' : contextId
        }. No subscription found.`
      );
    }
    const eventMap = contextToEventMap.get(contextId)!;

    if (!eventMap.has(event)) {
      throw new Message.InvalidArgumentException(
        `Cannot unsubscribe from ${event}, ${
          contextId === null ? 'null' : contextId
        }. No subscription found.`
      );
    }

    return () => {
      eventMap.delete(event);

      // Clean up maps if empty.
      if (eventMap.size === 0) {
        contextToEventMap.delete(event);
      }
      if (contextToEventMap.size === 0) {
        this.#channelToContextToEventMap.delete(channel);
      }
    };
  }
}
