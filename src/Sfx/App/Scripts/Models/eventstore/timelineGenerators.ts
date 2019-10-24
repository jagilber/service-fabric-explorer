module Sfx {
    export interface ITimelineData {
        groups: vis.DataSet<vis.DataGroup>;
        items: vis.DataSet<vis.DataItem>;
        start?: Date;
        end?: Date;
    }

    export interface ITimelineDataGenerator<T extends FabricEventBase>{

        consume(events: T[], startOfRange: Date, endOfRange: Date): ITimelineData;
    }

    export class EventStoreUtils {
        public static tooltipFormat = (event: FabricEventBase, start: string, end: string = "", title: string= ""): string => {

            const rows = Object.keys(event.eventProperties).map(key => `<tr><td style="word-break: keep-all;">${key}</td><td> : ${event.eventProperties[key]}</td></tr>`).join("");

            const outline = `<table style="word-break: break-all;"><tbody>${rows}</tbody></table>`;

            return `<div class="tooltip-test">${title.length > 0 ? title + "<br>" : ""}Start: ${start} <br>${ end ? "End: " + end + "<br>" : ""}<b style="text-align: center;">Details</b><br>${outline}</div>`;
        }

        public static parseUpgradeAndRollback(rollbackCompleteEvent: FabricEventBase, rollbackStartedEvent: ClusterEvent, items: vis.DataSet<vis.DataItem>, startOfRange: Date, group: string, targetVersionProperty: string) {
            const rollbackEnd = rollbackCompleteEvent.timeStamp;

            let rollbackStarted = startOfRange.toISOString();
            //wont always get this event because of the time range that can be selected where we only get the 
            //rollback completed which leaves us missing some of the info.
            if (rollbackStartedEvent) {
                rollbackStarted = rollbackStartedEvent.timeStamp;
                const rollbackStartedDate = new Date(rollbackEnd);
                const upgradeDuration = rollbackCompleteEvent.eventProperties["OverallUpgradeElapsedTimeInMs"];

                const upgradeStart = new Date(rollbackStartedDate.getTime() - upgradeDuration).toISOString();
                //roll forward
                items.add({
                    id: rollbackCompleteEvent.eventInstanceId + "upgrade",
                    content: "Upgrade rolling forward failed",
                    start: upgradeStart,
                    end: rollbackStarted,
                    group,
                    type: "range",
                    className: "red"
                });
            }

            const label = `rolling back to ${rollbackCompleteEvent.eventProperties[targetVersionProperty]}`;

            //roll back
            items.add({
                id: rollbackCompleteEvent.eventInstanceId + label,
                content: label,
                start: rollbackStarted,
                end: rollbackEnd,
                group,
                type: "range",
                title: EventStoreUtils.tooltipFormat(rollbackCompleteEvent, rollbackStarted, rollbackEnd),
                className: "orange"
            });

        }

        public static parseUpgradeDomain(event: FabricEventBase, items: vis.DataSet<vis.DataItem>, group: string, targetVersionProperty: string): void {
            const end = event.timeStamp;
            const endDate = new Date(end);
            const duration = event.eventProperties["UpgradeDomainElapsedTimeInMs"];

            const start = new Date(endDate.getTime() - duration).toISOString();
            const label = event.eventProperties["UpgradeDomains"];
            items.add({
                id: event.eventInstanceId + label + event.eventProperties[targetVersionProperty],
                content: label,
                start: start,
                end: end,
                group,
                type: "range",
                title: EventStoreUtils.tooltipFormat(event, start, end),
                className: "green"
            });
        }

        //Mainly used for if there is a current upgrade in progress.
        public static parseUpgradeStarted(event: FabricEventBase, items: vis.DataSet<vis.DataItem>, endOfRange: Date, group: string, targetVersionProperty: string): void {

            let end = endOfRange.toISOString();
            const start = event.timeStamp;
            const content = `Upgrading to ${event.eventProperties[targetVersionProperty]}`;

            items.add({
                id: event.eventInstanceId + content,
                content,
                start,
                end,
                group,
                type: "range",
                title: EventStoreUtils.tooltipFormat(event, start, end),
                className: "blue"
            });
        }

        public static parseUpgradeCompleted(event: FabricEventBase, items: vis.DataSet<vis.DataItem>, group: string, targetVersionProperty: string): void {
            const rollBack = event.kind === "ClusterUpgradeRollbackCompleted";

            const end = event.timeStamp;
            const endDate = new Date(end);
            const duration = event.eventProperties["OverallUpgradeElapsedTimeInMs"];

            const start = new Date(endDate.getTime() - duration).toISOString();
            const content = `${rollBack ? "Upgrade Rolling back" : "Upgrade rolling forward"} to ${event.eventProperties[targetVersionProperty]}`;

            items.add({
                id: event.eventInstanceId + content,
                content,
                start,
                end,
                group,
                type: "range",
                title: EventStoreUtils.tooltipFormat(event, start, end),
                className: rollBack  ? "orange" : "green"
            });
        }
    }

    export class ClusterTimelineGenerator implements ITimelineDataGenerator<ClusterEvent> {
        static readonly upgradeDomainLabel = "Upgrade Domains";
        static readonly clusterUpgradeLabel = "Cluster Upgrades";
        static readonly seedNodeStatus = "Seed Node Warnings";

        consume(events: ClusterEvent[], startOfRange: Date, endOfRange: Date): ITimelineData {
            let items = new vis.DataSet<vis.DataItem>();

            //state necessary for some events
            let previousClusterHealthReport: ClusterEvent;
            let previousClusterUpgrade: ClusterEvent;
            let upgradeClusterStarted: ClusterEvent;
            let clusterRollBacks: Record<string, {complete: ClusterEvent, start?: ClusterEvent}> = {};

            events.forEach( event => {
                //we want the oldest cluster upgrade started before finding any previousClusterUpgrade
                //this means we should have an ongoing cluster upgrade
                if ( (event.kind === "ClusterUpgradeStarted" || event.kind === "ClusterUpgradeRollbackStarted") && !previousClusterUpgrade ) {
                    upgradeClusterStarted = event;
                }else if (event.kind === "ClusterUpgradeDomainCompleted") {
                    EventStoreUtils.parseUpgradeDomain(event, items, ClusterTimelineGenerator.upgradeDomainLabel, "TargetClusterVersion");
                }else if (event.kind === "ClusterUpgradeCompleted") {
                    EventStoreUtils.parseUpgradeCompleted(event, items, ClusterTimelineGenerator.clusterUpgradeLabel, "TargetClusterVersion");
                    previousClusterUpgrade = event;
                }else if (event.kind === "ClusterNewHealthReport") {
                    this.parseSeedNodeStatus(event, items, previousClusterHealthReport, endOfRange);
                    previousClusterHealthReport = event;
                }

                //handle roll backs alone
                if (event.kind === "ClusterUpgradeRollbackCompleted") {
                    previousClusterUpgrade = event;
                    clusterRollBacks[event.eventInstanceId] = {complete: event};
                }else if (event.kind === "ClusterUpgradeRollbackStarted" && event.eventInstanceId in clusterRollBacks) {
                    clusterRollBacks[event.eventInstanceId]["start"] = event;
                }
            });

            //we have to parse cluster upgrade roll backs into 2 seperate events and require 2 seperate events to piece together
            //we gather them up and add them at the end so we can get corresponding events
            Object.keys(clusterRollBacks).forEach(eventInstanceId => {
                const data = clusterRollBacks[eventInstanceId];
                // this.parseClusterUpgradeAndRollback(data.complete, data.start, items, startOfRange);
                EventStoreUtils.parseUpgradeAndRollback(data.complete, data.start, items, startOfRange,
                                                                ClusterTimelineGenerator.clusterUpgradeLabel, "TargetClusterVersion");
            });

            //Display a pending upgrade
            if (upgradeClusterStarted) {
                EventStoreUtils.parseUpgradeStarted(upgradeClusterStarted, items, endOfRange, ClusterTimelineGenerator.clusterUpgradeLabel, "TargetClusterVersion");
            }

            let groups = new vis.DataSet<vis.DataGroup>([
                {id: ClusterTimelineGenerator.upgradeDomainLabel, content: ClusterTimelineGenerator.upgradeDomainLabel},
                {id: ClusterTimelineGenerator.clusterUpgradeLabel, content: ClusterTimelineGenerator.clusterUpgradeLabel},
                {id: ClusterTimelineGenerator.seedNodeStatus, content: ClusterTimelineGenerator.seedNodeStatus}
            ]);

            return {
                groups,
                items
            };
        }

        parseSeedNodeStatus(event: ClusterEvent, items: vis.DataSet<vis.DataItem>, previousClusterHealthReport: ClusterEvent, endOfRange: Date): void {
            if (event.eventProperties["HealthState"] === "Warning") {
                //for end date if we dont have a previously seen health report(list iterates newest to oldest) then we know its still the ongoing state
                let end = previousClusterHealthReport ? previousClusterHealthReport.timeStamp : endOfRange.toISOString();
                const content = `${event.eventProperties["HealthState"]}`;

                items.add({
                    id: event.eventInstanceId + content,
                    content,
                    start: event.timeStamp,
                    end: end,
                    group: ClusterTimelineGenerator.seedNodeStatus,
                    type: "range",
                    title: EventStoreUtils.tooltipFormat(event, event.timeStamp, end),
                    className: "orange"
                });
            }
        }
    }
    export class NodeTimelineGenerator implements ITimelineDataGenerator<NodeEvent> {
        static readonly NodesDownLabel = "Node Down";

        consume(events: NodeEvent[], startOfRange: Date, endOfRange: Date): ITimelineData {
            let items = new vis.DataSet<vis.DataItem>();

            let previousTransitions: Record<string, NodeEvent> = {};

            events.forEach( event => {
                if (event.category === "StateTransition") {
                    //check for current state
                    if (event.kind === "NodeDown") {
                        const end = previousTransitions[event.nodeName] ? previousTransitions[event.nodeName].timeStamp : endOfRange.toISOString();
                        const start = event.timeStamp;
                        const label = "Node " + event.nodeName + " down";
                        items.add({
                            id: event.eventInstanceId + label,
                            content: label,
                            start: start,
                            end: end,
                            group: NodeTimelineGenerator.NodesDownLabel,
                            type: "range",
                            title: EventStoreUtils.tooltipFormat(event, start, end, label),
                            className: "red"
                        });
                    }

                    if (event.kind === "NodeUp") {
                        previousTransitions[event.nodeName] = event;
                    }
                };
            });

            let groups = new vis.DataSet<vis.DataGroup>([
                {id: NodeTimelineGenerator.NodesDownLabel, content: NodeTimelineGenerator.NodesDownLabel},
            ]);

            return {
                groups,
                items
            };
        }
    }

    export class ApplicationTimelineGenerator implements ITimelineDataGenerator<ApplicationEvent> {
        static readonly upgradeDomainLabel = "Upgrade Domains";
        static readonly applicationUpgradeLabel = "Application Upgrades";
        static readonly applicationPrcoessExitedLabel = "Application Process Exited";

        consume(events: ApplicationEvent[], startOfRange: Date, endOfRange: Date): ITimelineData {
            let items = new vis.DataSet<vis.DataItem>();

            //state necessary for some events
            let previousApplicationUpgrade: ApplicationEvent;
            let upgradeApplicationStarted: ApplicationEvent;
            let applicationRollBacks: Record<string, {complete: ApplicationEvent, start?: ApplicationEvent}> = {};
            let processExitedGroups: Record<string, vis.DataGroup> = {};

            events.forEach( event => {
                //we want the oldest upgrade started before finding any previousApplicationUpgrade
                //this means we should have an ongoing application upgrade
                if ( (event.kind === "ApplicationUpgradeStarted" || event.kind === "ApplicationUpgradeRollbackStarted") && !previousApplicationUpgrade ) {
                    upgradeApplicationStarted = event;
                }else if (event.kind === "ApplicationUpgradeDomainCompleted") {
                    EventStoreUtils.parseUpgradeDomain(event, items, ApplicationTimelineGenerator.upgradeDomainLabel, "ApplicationTypeVersion");
                }else if (event.kind === "ApplicationUpgradeCompleted") {
                    EventStoreUtils.parseUpgradeCompleted(event, items, ApplicationTimelineGenerator.applicationUpgradeLabel, "ApplicationTypeVersion");
                    previousApplicationUpgrade = event;
                }else if (event.kind === "ApplicationProcessExited") {
                    this.parseApplicationProcessExited(event, items, processExitedGroups);
                }

                //handle roll backs alone
                if (event.kind === "ApplicationUpgradeRollbackCompleted") {
                    previousApplicationUpgrade = event;
                    applicationRollBacks[event.eventInstanceId] = {complete: event};
                }else if (event.kind === "ApplicationUpgradeRollbackStarted" && event.eventInstanceId in applicationRollBacks) {
                    applicationRollBacks[event.eventInstanceId]["start"] = event;
                }
            });

            //we have to parse application upgrade roll backs into 2 seperate events and require 2 seperate events to piece together
            //we gather them up and add them at the end so we can get corresponding events
            Object.keys(applicationRollBacks).forEach(eventInstanceId => {
                const data = applicationRollBacks[eventInstanceId];
                EventStoreUtils.parseUpgradeAndRollback(data.complete, data.start, items, startOfRange, ApplicationTimelineGenerator.applicationUpgradeLabel, "ApplicationTypeVersion");
            });

            //Display a pending upgrade
            if (upgradeApplicationStarted) {
                EventStoreUtils.parseUpgradeStarted(upgradeApplicationStarted, items, endOfRange, ApplicationTimelineGenerator.applicationUpgradeLabel, "ApplicationTypeVersion");
            }

            let groups = new vis.DataSet<vis.DataGroup>([
                {id: ApplicationTimelineGenerator.upgradeDomainLabel, content: ApplicationTimelineGenerator.upgradeDomainLabel},
                {id: ApplicationTimelineGenerator.applicationUpgradeLabel, content: ApplicationTimelineGenerator.applicationUpgradeLabel},
            ]);

            let nestedApplicationProcessExited: vis.DataGroup = {
                id: ApplicationTimelineGenerator.applicationPrcoessExitedLabel,
                nestedGroups: [], subgroupStack: false,
                content: ApplicationTimelineGenerator.applicationPrcoessExitedLabel,
            };
            Object.keys(processExitedGroups).forEach(groupName => {
                nestedApplicationProcessExited.nestedGroups.push(groupName);
                groups.add(processExitedGroups[groupName]);
            });

            groups.add(nestedApplicationProcessExited);

            return {
                groups,
                items
            };
        }


        parseApplicationProcessExited(event: FabricEventBase, items: vis.DataSet<vis.DataItem>, processExitedGroups: Record<string, vis.DataGroup>) {

            const groupLabel = `${event.eventProperties["ServicePackageName"]}`;
            processExitedGroups[groupLabel] = {id: groupLabel, content: groupLabel, subgroupStack: {"1": false}};

            const start = event.timeStamp;
            const label = event.eventProperties["ExeName"];

            items.add({
                id: event.eventInstanceId + label,
                content: "",
                start: start,
                group: groupLabel,
                type: "point",
                subgroup: "1",
                className: "red-point",
                title: EventStoreUtils.tooltipFormat(event, start, null, "Primary swap to " + label),
            });
        }
    }

    export class PartitionTimelineGenerator implements ITimelineDataGenerator<NodeEvent> {
        static readonly swapPrimaryLabel = "Primay Swap";
        static readonly swapPrimaryDurations = "Swap Primary phases";

        consume(events: NodeEvent[], startOfRange: Date, endOfRange: Date): ITimelineData {
            let items = new vis.DataSet<vis.DataItem>();

            events.forEach( event => {
                if (event.category === "StateTransition" && event.eventProperties["ReconfigType"] === "SwapPrimary") {
                    const end = event.timeStamp;
                    const endDate = new Date(end);
                    const duration = event.eventProperties["TotalDurationMs"];
                    const start = new Date(endDate.getTime() - duration).toISOString();
                    const label = event.eventProperties["NodeName"];

                    items.add({
                        id: event.eventInstanceId + label,
                        content: label,
                        start: start,
                        end: end,
                        group: PartitionTimelineGenerator.swapPrimaryLabel,
                        type: "range",
                        title: EventStoreUtils.tooltipFormat(event, start, end, "Primary swap to " + label),
                        className: "green"
                    });

                };
            });

            let groups = new vis.DataSet<vis.DataGroup>([
                {id: PartitionTimelineGenerator.swapPrimaryLabel, content: PartitionTimelineGenerator.swapPrimaryLabel},
            ]);

            return {
                groups,
                items
            };
        }
    }
}