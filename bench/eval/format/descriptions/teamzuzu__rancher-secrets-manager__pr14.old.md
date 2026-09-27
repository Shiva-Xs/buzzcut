docs: uninstall the UI extension from Installed Apps, not the Extensions tab

In Rancher 2.14 the Uninstall button under Extensions → Installed doesn't work for community extensions: the App object is synthesized from the Helm secret instead of being owned by Rancher's catalog, so the catalog delete fails silently. Uninstall step 2 in the README now says to delete `rancher-secrets-manager-ui` from ☰ → Apps → Installed Apps on the local cluster, with a note about the Extensions tab. Not tested.
