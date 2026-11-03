<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Channel Point Rewards & Raids

`TwitchEventSubIntegration` publishes redemptions and raids on the EventBus; nothing else in the
integration layer knows about them. `RewardRouter` subscribes to `twitch.channelPoint.redemption`
and runs the `IRewardHandler` whose `rewardTitle` matches the redemption's title exactly — titles
are unique per channel and rarely renamed, so there are no stored reward ids. Handlers are
auto-discovered like commands: one class per reward in `rewards/implementations/`, default-exported
and `@injectable()`. A redemption with no handler is normal (a reward for the streamer to act on)
and is ignored; a handler that throws is logged and never stops the next redemption.

Each handler also declares its reward's settings (`reward: RewardDefinition`). `RewardSync` makes
Twitch match them whenever the Twitch API connects and whenever a stream break starts or ends:
creating missing rewards, correcting drifted settings, and pausing `pauseDuringBreaks` rewards for
the break. Twitch only lets the application that created a reward edit it, so a same-titled reward
made elsewhere is reported once and left alone (its handler still runs). For rewards TuringMod
does own, `RewardRouter` resolves queued redemptions afterwards — fulfilled on success, canceled
(refunding the viewer) if the handler threw — which is why `autoFulfill` defaults off. Whether
TuringMod owns a reward is only known once a pass has read Twitch's rewards, so a redemption after a
failed sync runs another pass first. If that fails too, or Twitch refuses the resolve, the redemption
stays in Twitch's queue and the streamer is told what to do with it (`service.error`). All of this
goes through the `CHANNEL_POINTS` platform capability, like any other platform action.

`RaidShoutout` handles `twitch.raid`: a chat message linking the raider plus Twitch's native
shoutout, through `StreamControlService` like any other platform action. The two are independent,
so a rate-limited native shoutout still gets the chat message.
