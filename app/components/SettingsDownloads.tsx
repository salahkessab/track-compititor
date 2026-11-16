export function SettingsDownloads() {
  const button = "ui-primary inline-block rounded-xl px-4 py-2.5 text-sm font-medium";
  return <section aria-label="Extensions and plugins" className="grid gap-4 md:grid-cols-2">
    <article className="studio-panel space-y-3 rounded-2xl border p-5">
      <h2 className="text-lg font-semibold">Chrome extension</h2>
      <p className="text-sm text-gray-600">Import a recipe and its photos from the page you have open.</p>
      <a className={button} href="/api/recipe-capture-extension" download="recipe-intelligence-capture.zip">Download Chrome extension</a>
      <p className="text-xs text-gray-600">Extract the ZIP, then open chrome://extensions → Developer mode → Load unpacked. Select the extracted folder, open this app and click the extension to connect.</p>
    </article>
    <article className="studio-panel space-y-3 rounded-2xl border p-5">
      <h2 className="text-lg font-semibold">WordPress plugin</h2>
      <p className="text-sm text-gray-600">Connect WordPress to upload images and send, publish or schedule articles.</p>
      <a className={button} href="/api/recipe-wordpress-plugin" download>Download WordPress plugin</a>
      <p className="text-xs text-gray-600">In WordPress, open Plugins → Add New → Upload Plugin. Install the ZIP, activate Recipe Intelligence Bridge, then use its Site Token to connect below.</p>
    </article>
  </section>;
}
