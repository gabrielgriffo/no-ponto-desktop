import { Component } from "@angular/core";
import { HoverResetService } from "./services/hover-reset.service";
import { RouterOutlet } from "@angular/router";
import { Toast } from "./components/toast/toast";

@Component({
  selector: "app-root",
  imports: [RouterOutlet, Toast],
  templateUrl: "./app.html",
  styleUrl: "./app.css",
})
export class App {
  constructor(hoverReset: HoverResetService) {
    hoverReset.init().catch(() => {});
  }
}
