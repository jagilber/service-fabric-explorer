import { Component, OnInit, Injector } from '@angular/core';
import { BaseController } from 'src/app/ViewModels/BaseController';
import { IResponseMessageHandler } from 'src/app/Common/ResponseMessageHandlers';
import { Observable, forkJoin } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { IdUtils } from 'src/app/Utils/IdUtils';
import { ActivatedRouteSnapshot } from '@angular/router';
import { ListColumnSetting, ListSettings } from 'src/app/Models/ListSettings';
import { DataService } from 'src/app/services/data.service';
import { SettingsService } from 'src/app/services/settings.service';
import { Service } from 'src/app/Models/DataModels/Service';

@Component({
  selector: 'app-details',
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss']
})
export class DetailsComponent extends BaseController {
  appId: string;
  serviceId: string;

  service: Service;
  healthEventsListSettings: ListSettings;
  serviceBackupConfigurationInfoListSettings: ListSettings;


  constructor(private data: DataService, injector: Injector, private settings: SettingsService) { 
    super(injector);
  }

  setup() {
    this.serviceBackupConfigurationInfoListSettings = this.settings.getNewOrExistingListSettings("serviceBackupConfigurationInfoListSettings", ["raw.PolicyName"], [
      new ListColumnSetting("raw.PolicyName", "Policy Name", ["raw.PolicyName"], false, (item, property) => `<a href='${item.parent.viewPath}/tab/details'>${property}</a>`, 1, item => item.action.runWithCallbacks.apply(item.action)),
      new ListColumnSetting("raw.Kind", "Kind"),
      new ListColumnSetting("raw.PolicyInheritedFrom", "Policy Inherited From"),
      new ListColumnSetting("raw.PartitionId", "Partition Id"),
      new ListColumnSetting("raw.SuspensionInfo.IsSuspended", "Is Suspended"),
      new ListColumnSetting("raw.SuspensionInfo.SuspensionInheritedFrom", "Suspension Inherited From"),
    ]);
    this.healthEventsListSettings = this.settings.getNewOrExistingHealthEventsListSettings();
  }

  refresh(messageHandler?: IResponseMessageHandler): Observable<any>{
    return this.data.getService(this.appId, this.serviceId, true, messageHandler).pipe(mergeMap(service => {
      this.service = service;

      if (this.service.isStatefulService) {
        this.service.serviceBackupConfigurationInfoCollection.refresh(messageHandler);
      }

      return forkJoin([
        this.service.health.refresh(messageHandler),
        this.service.description.refresh(messageHandler),
        this.service.partitions.refresh(messageHandler),
        this.data.backupPolicies.refresh(messageHandler)
      ]);
    }))
  }

  getParams(route: ActivatedRouteSnapshot): void {
    this.appId = IdUtils.getAppId(route);
    this.serviceId = IdUtils.getServiceId(route);
  }
}