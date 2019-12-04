import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DeployedApplicationRoutingModule } from './deployed-application-routing.module';
import { BaseComponent } from './base/base.component';
import { EssentialsComponent } from './essentials/essentials.component';
import { DetailsComponent } from './details/details.component';
import { SharedModule } from 'src/app/shared/shared.module';


@NgModule({
  declarations: [BaseComponent, EssentialsComponent, DetailsComponent],
  imports: [
    CommonModule,
    DeployedApplicationRoutingModule,
    SharedModule
  ]
})
export class DeployedApplicationModule { }