// Tahoe Dock — entry point called by GNOME Shell's extension system. The
// dock itself is lib/controller.js, shared with Cinnamon (extension.js at
// the project root).

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { DockController } from "./lib/controller.js";
import { DockSettings } from "./lib/settings.js";

export default class TahoeDockExtension extends Extension {
    enable() {
        // Monitors and backgrounds are only in place once startup is done.
        if (Main.layoutManager._startingUp)
            this._startupId = Main.layoutManager.connect("startup-complete", () => {
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
                this._start();
            });
        else
            this._start();
    }

    _start() {
        this._controller = new DockController(callbacks => new DockSettings(this.getSettings(), callbacks));
        this._controller.enable();
        this._hideDash();
        console.log("Tahoe Dock v" + this.metadata["version-name"] + " ativo");
    }

    // The overview's own dash would be a second dock under this one; it
    // keeps a pixel of height, so the overview leaves no room for it.
    _hideDash() {
        const dash = Main.overview.dash;
        if (!dash)
            return;
        this._dash = dash;
        dash.hide();
        dash.set_height(1);
    }

    disable() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        if (this._dash) {
            this._dash.set_height(-1);
            this._dash.show();
            this._dash = null;
        }
        if (this._controller) {
            this._controller.disable();
            this._controller = null;
            console.log("Tahoe Dock v" + this.metadata["version-name"] + " desativado");
        }
    }
}
