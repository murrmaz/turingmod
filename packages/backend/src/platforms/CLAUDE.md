# Platform façades

How the platform layer is built: the `IStreamPlatform` façades, their capability objects, and the seam they share with the API integrations. Claude Code loads this file when you work in this directory; how commands and features *use* platforms is summarized in the root `CLAUDE.md` (Platform Provider Layer), and the integrations behind the façades are described in `../integrations/CLAUDE.md`.

`IStreamPlatform` is a platform-agnostic façade over one platform's integration group, registered
in `PlatformRegistry` and consumed through `StreamControlService`.

**An API integration owns the connection; the platform façade owns what is done with it.**
`TwitchApiIntegration` and `YouTubeApiIntegration` keep a client built on the current grant,
report status, and notice a revoked grant; they expose that as `request(fn)`, which runs one call
through the live client. They hold no endpoint wrappers and no platform rules, only what another
*integration* also needs (`YouTubeApiIntegration.getActiveBroadcast()`, used by chat). Every
endpoint commands rely on, and every platform rule around one (Twitch category lookup, snooze
checks, shoutout cooldowns in `TwitchShoutoutCooldowns`), lives in `TwitchPlatform` /
`YouTubePlatform`, which call through `request()`. A new platform feature is therefore one change
to the façade, not a wrapper in the integration plus a call to it. The same split holds for
integrations that aren't platforms, where the role of the façade is played by the feature using
it: `SoundLibrary` over `SoundIntegration`, and `!song` (`SongCommand`) over
`SpotifyApiIntegration.request()`. Commands depend on this seam, not
on integrations — a command should never resolve `TwitchApiIntegration`/`TwitchAuthIntegration` from
the container. Platform-specific logic (Twitch category name → id resolution) lives inside the
façade, and the DTOs crossing it (`StreamInfo`, `ScheduleSegment`, `AdBreakInfo`) are agnostic, so no
Twurple/googleapis types leak into the interface.

**Having a capability object is having the capability.** What only some platforms can do is
grouped into optional capability objects on `IStreamPlatform` (`ads?: AdsApi`,
`channelPoints?: ChannelPointsApi`, `moderation?: ModerationApi`, …; all listed in
`CapabilityApis`). Callers get one with `StreamControlService.require(platform, 'channelPoints')`,
which returns it typed or throws. A façade's capability set is never written out:
`capabilitiesOf()` (`platforms/capabilities.ts`) derives it from the objects it has, plus the five
capabilities no object stands for (`SEND_CHAT`, `UPTIME` and the `SET_*` fields of
`setStreamInfo()`), which the façade lists in `declaredCapabilities`. Its type admits only those
five, and `CAPABILITY_OF_API` pairs every other `PlatformCapability` with its object, so
advertising a capability without implementing it, or adding a `PlatformCapability` with no object,
is a compile error. A command declares `requiredCapabilities` and is hidden on platforms that don't
satisfy them (`CommandExecutor` treats hidden as `COMMAND_NOT_FOUND`). The console gets each
command's `availableOn` from `commands.list` rather than keeping its own copy of each platform's set.
