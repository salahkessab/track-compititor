# Use the app independently on two Windows PCs

Each computer runs its own app and stores its own articles and images. Neither
computer needs to stay on for the other one to work. No cloud hosting is needed;
OpenAI API usage is still billed separately.

## Set up each computer

1. Install Node.js 24 LTS with npm.
2. Extract the app into a permanent local folder, such as
   `C:\RecipeStudio`. Do not run it inside the ZIP.
3. Copy `.env.example` to `.env.local`. Enter your `OPENAI_API_KEY` in
   `.env.local`. Keep `R2_ENABLED=0` for independent local storage. Never share
   this file or upload it to GitHub.
4. Double-click **Start Recipe Intelligence.cmd**. On first launch, select a
   local storage folder. Dependency installation and the first build can take
   several minutes. Subsequent launches reuse the build.
5. Use the browser page opened by the launcher. The old Vercel address is a
   different installation and does not open this local workspace.
6. Reconnect your WordPress site in Settings on each computer. Saved credentials
   are protected by that computer's Windows account; copying the database does
   not transfer usable credentials.
7. In Chrome, install the unpacked extension from
   `extensions/recipe-intelligence-capture`. Open the local app in the same
   Chrome profile and click the extension to connect it to this workspace.

The extension saves articles for review. Generation starts only when you click
**Generate**. An estimate or reserved maximum of $2.50 or more asks for
confirmation first.

## Daily use

- Double-click **Start Recipe Intelligence.cmd** to open the app.
- Keep the PC awake and connected while generation or publishing is running.
- Wait for work to finish, then use **Stop Recipe Intelligence.cmd** before
  shutting down. Closing the browser alone does not stop the local worker.
- Use the app's delete actions to remove unwanted local articles and files.
  Do not manually delete the database or storage folder while the app runs.
- Articles published to WordPress remain on WordPress when removed locally.
- Each PC has separate history, files, settings and extension connections.
  Cloud history is not automatically imported.

## Updates and troubleshooting

Stop the app before replacing its application files. Keep `.env.local` private
and preserve the storage folder. Start again to rebuild changed application
code. Reload the extension in `chrome://extensions` after updating its files.

Startup diagnostics are in
`%LOCALAPPDATA%\RecipeIntelligence\startup.log`. The selected storage folder
also contains application and worker logs. Do not share logs without checking
them for private information.
