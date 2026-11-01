import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';
import {
  CircleAlert,
  Copy,
  KeyRound,
  type LucideIcon,
  Play,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CONFIG_SETUP_REGISTRY } from '@/components/integrations/config-integration-registry';
import { StatusDot, TONE_TEXT } from '@/components/status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppState } from '@/context/app-state-context';
import { useIntegrationActions } from '@/hooks/useIntegrationActions';
import {
  type IntegrationAction,
  integrationActions,
  missingDependencies,
} from '@/lib/integrationActions';
import {
  describeIntegration,
  integrationChains,
  standaloneIntegrations,
} from '@/lib/integrationStatus';
import { copyToClipboard } from '@/lib/reportError';
import { cn } from '@/lib/utils';

const ACTION_ICONS: Record<IntegrationAction['kind'], LucideIcon> = {
  authorize: KeyRound,
  start: Play,
  stop: Square,
};

export function IntegrationsPage() {
  const { integrations } = useAppState();
  const actions = useIntegrationActions();
  const [params, setParams] = useSearchParams();
  const selectedName = params.get('selected');
  const selected = integrations.find((i) => i.name === selectedName) ?? null;
  const select = (name: string | null) => setParams(name ? { selected: name } : {});

  const chains = integrationChains(integrations);
  const standalone = standaloneIntegrations(integrations);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Integrations</h2>
          <p className="text-sm text-muted-foreground">
            Each chain starts in order: a link only connects once the one before it has.
          </p>
        </div>

        {integrations.length === 0 && (
          <div className="grid max-w-3xl grid-cols-3 gap-9">
            {Array.from({ length: 6 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <Skeleton key={index} className="h-[68px] rounded-[10px]" />
            ))}
          </div>
        )}

        {chains.map((chain) => (
          <Group key={chain.group.id} label={chain.group.label}>
            <div className="flex items-center">
              {chain.items.map((integration, index) => (
                <Fragment key={integration.name}>
                  {index > 0 && <div aria-hidden className="h-px w-9 shrink-0 bg-border" />}
                  <IntegrationNode
                    integration={integration}
                    selected={integration.name === selectedName}
                    onSelect={() => select(integration.name)}
                  />
                </Fragment>
              ))}
            </div>
          </Group>
        ))}

        {standalone.length > 0 && (
          <Group label="Standalone">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
              {standalone.map((integration) => (
                <IntegrationNode
                  key={integration.name}
                  integration={integration}
                  selected={integration.name === selectedName}
                  onSelect={() => select(integration.name)}
                />
              ))}
            </div>
          </Group>
        )}
      </div>

      {selected && (
        <IntegrationDetail
          integration={selected}
          all={integrations}
          actions={actions}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex max-w-4xl flex-col gap-2.5">
      <h3 className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </h3>
      {children}
    </section>
  );
}

function IntegrationNode({
  integration,
  selected,
  onSelect,
}: {
  integration: IntegrationInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const display = describeIntegration(integration);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-1 basis-0 flex-col gap-1 rounded-[10px] border bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent/40',
        display.needsAttention && 'border-destructive/50',
        selected && 'ring-2 ring-ring'
      )}
    >
      <span className="truncate font-mono text-sm font-medium">{integration.name}</span>
      <span className={cn('flex items-center gap-2 text-[13px]', TONE_TEXT[display.tone])}>
        <StatusDot
          tone={display.tone}
          pulse={integration.status === IntegrationStatus.CONNECTING}
        />
        {display.label}
      </span>
    </button>
  );
}

function IntegrationDetail({
  integration,
  all,
  actions,
  onClose,
}: {
  integration: IntegrationInfo;
  all: IntegrationInfo[];
  actions: ReturnType<typeof useIntegrationActions>;
  onClose: () => void;
}) {
  const display = describeIntegration(integration);
  const offered = integrationActions(integration, all);
  const busy = actions.isBusy(integration);
  const waitingOn = missingDependencies(integration, all);
  const dependsOn = integration.metadata?.dependencies ?? [];
  const usedBy = all
    .filter((other) => other.metadata?.dependencies?.includes(integration.name))
    .map((other) => other.name);
  const problem =
    integration.errorMessage &&
    (integration.status === IntegrationStatus.ERROR ||
      integration.status === IntegrationStatus.NEEDS_REAUTH);

  const SetupModal = CONFIG_SETUP_REGISTRY[integration.name];
  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-l p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate font-mono text-base font-semibold">{integration.name}</h3>
          <span className={cn('flex items-center gap-2 text-[13px]', TONE_TEXT[display.tone])}>
            <StatusDot tone={display.tone} />
            {display.label}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>

      {problem && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="font-mono text-[12.5px]">
            {integration.errorMessage}
          </AlertDescription>
        </Alert>
      )}
      {!problem && integration.errorMessage && (
        <p className="text-sm text-muted-foreground">{integration.errorMessage}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {offered.map((action) => {
          const Icon = ACTION_ICONS[action.kind];
          return (
            <Button
              key={action.kind}
              variant={action.kind === 'stop' ? 'outline' : 'default'}
              onClick={() => actions.run(action)}
              disabled={busy}
              // "Reconnect youtube-auth" doesn't fit in half the panel.
              className={cn(action.target !== integration && 'col-span-2')}
            >
              <Icon />
              {action.label}
            </Button>
          );
        })}
        {SetupModal && (
          <Button variant="outline" onClick={() => setSetupOpen(true)}>
            <Settings />
            Set up
          </Button>
        )}
      </div>

      {SetupModal && setupOpen && (
        <SetupModal
          integration={integration}
          onDismiss={() => setSetupOpen(false)}
          // A running integration restarts on its new config; one that isn't is started on it.
          onSaved={() => {
            setSetupOpen(false);
            if (!integration.enabled) {
              actions.start(integration);
            }
          }}
        />
      )}

      {waitingOn.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Runs once {waitingOn.join(', ')} {waitingOn.length === 1 ? 'connects' : 'connect'}.
        </p>
      )}

      <dl className="flex flex-col text-sm">
        <Detail label="Depends on">{dependsOn.length > 0 ? dependsOn.join(', ') : '—'}</Detail>
        <Detail label="Needed by">{usedBy.length > 0 ? usedBy.join(', ') : '—'}</Detail>
        {integration.oauth && (
          <Detail label="Redirect URI">
            <span className="flex items-center gap-2">
              <span className="min-w-0 break-all">{integration.oauth.redirectUri}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                aria-label="Copy redirect URI"
                onClick={() =>
                  void copyToClipboard(integration.oauth?.redirectUri ?? '', 'redirect URI')
                }
              >
                <Copy className="size-3.5" />
              </Button>
            </span>
          </Detail>
        )}
        {integration.oauth && (
          <Detail label="Client credentials">
            {integration.oauth.configured ? (
              <span className="flex items-center gap-2">
                saved
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 font-sans text-xs"
                  onClick={() => actions.changeCredentials(integration)}
                >
                  Change
                </Button>
              </span>
            ) : (
              'not set up yet'
            )}
          </Detail>
        )}
        <Detail label="Enabled">
          {integration.enabled
            ? dependsOn.length > 0
              ? `yes — comes back when ${dependsOn.join(', ')} recovers`
              : 'yes — starts with TuringMod'
            : 'no'}
        </Detail>
      </dl>
    </aside>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[13px]">{children}</dd>
    </div>
  );
}
