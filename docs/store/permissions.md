# Store permission explanations

Single purpose: Send browser downloads and discovered or user-captured media to the local Rayburst desktop app.

## downloads

Intercept eligible browser downloads, hand them to the local Rayburst app, and cancel or remove the browser entry only according to the handoff result. The popup also displays download activity.

## storage

Store connection settings, site rules, appearance preferences and a bounded diagnostic log locally. Browser session storage holds temporary media resources and pending handoffs.

## contextMenus

Add a Download with Rayburst action for links, images, audio and video so users can send a selected resource to their desktop.

## notifications

Notify the user when duplicate download protection skips a repeated request. Rayburst handles desktop task progress and completion.

## webRequest

Observe download and media requests, filenames and selected request headers. This supplies resource discovery and the request context needed by the local desktop to retrieve a selected source.

## webNavigation

Associate discoveries with the correct tab, frame and document, and clear or preserve them according to navigation settings.

## alarms

Expire inactive media resources and bounded session data when the extension background worker resumes.

## cookies

Read cookies for a selected download source when cookie forwarding is enabled. Cookies go to the local Rayburst app for authenticated source requests; users can disable forwarding.

## nativeMessaging

Start the installed Rayburst desktop app through its registered native host. The only message is an activation request; URLs, cookies, media and arbitrary commands are not passed through this channel.

## scripting

Install page hooks for user-enabled deep search, buffer capture and recording modes. These hooks discover or capture media for the selected task.

## declarativeNetRequest

Apply temporary mobile User-Agent request rules when the user selects that media tool. Rules are scoped to the selected tab and do not replace the browser rendering engine.

## sidePanel

Display the Sniffer workspace in the browser sidebar so users can inspect page resources without closing the current page.

## downloads.ui

Optionally hide the Chromium download bar when the user enables that setting. This permission is requested only for that feature.

## webRequestBlocking

On Firefox, cancel confirmed attachment or binary responses before the save dialog opens when interception is enabled. The task is then handed to Rayburst.

## webRequestFilterResponse

On Firefox, inspect bounded copies of response data in user-enabled deep-search or buffer-capture modes while forwarding the original response bytes unchanged.

## host_permissions

Access HTTP and HTTPS pages because downloads and media can originate from any site. Access supplies resource discovery, user-enabled capture and cookies for the selected source. Localhost access connects to the Rayburst API on the same computer. Previews contact the user-selected source. No browsing data is sent to developer-operated servers.

## tabs

Read tab information to label and scope discovered media, access the selected resource workspace, and coordinate user-requested capture or tab reloads.

## Data handling declarations

Disclose authentication information (forwarded cookies and the local API secret), browsing activity (source URLs and tab context), and website content (discovered or captured media). Processing on the device still counts as handling user data. Do not use a blanket declaration that no data is handled. The extension does not sell data, use it for unrelated purposes or assess creditworthiness. No remote executable code is loaded; playback dependencies are bundled.
