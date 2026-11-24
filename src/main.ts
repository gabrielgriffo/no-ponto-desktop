import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app/app";
import { appConfig } from "./app/app.config";
import { installAppBehavior } from "./app/browser-shortcuts";

installAppBehavior(document);

bootstrapApplication(App, appConfig).catch((err) =>
  console.error(err),
);
