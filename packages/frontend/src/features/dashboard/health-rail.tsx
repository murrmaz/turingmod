import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { CircleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/context/AppStateContext';
import { useIntegrationActions } from '@/hooks/useIntegrationActions';
import { describeIntegration, inDisplayOrder } from '@/lib/integrationStatus';
import { reconnectTarget } from '@/lib/reconnect';

/**
 * The dashboard's right-hand column: quiet while everything is healthy, a red card per broken
 * integration when something isn't.
 */
export function HealthRail() {
  const { integrations } = useAppState();
  const actions = useIntegrationActions();
  const navigate = useNavigate();
  const broken = integrations.filter((i) => describeIntegration(i).needsAttention);
  const live = integrations.filter((i) => !i.placeholder);
  const up = live.filter((i) => i.status === IntegrationStatus.CONNECTED).length;
  const planned = integrations.length - live.length;

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      {broken.map((integration) => (
        <NeedsAttention
          key={integration.name}
          integration={integration}
          all={integrations}
          busy={actions.getActionState(integration).isLoading}
          onReconnect={() => actions.handleReconnect(integration)}
        />
      ))}

      <section className="rounded-xl border">
        <header className="flex items-baseline justify-between px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold">Integrations</h2>
          <span className="text-xs text-muted-foreground">
            {up} up{planned > 0 && ` · ${planned} planned`}
          </span>
        </header>
        <ul className="pb-2">
          {inDisplayOrder(integrations).map((integration) => {
            const display = describeIntegration(integration);
            return (
              <li key={integration.name}>
                <button
                  type="button"
                  onClick={() => navigate(`/integrations?selected=${integration.name}`)}
                  className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left hover:bg-accent/50"
                >
                  <StatusDot tone={display.tone} />
                  <span className="font-mono text-[12.5px]">{integration.name}</span>
                  <span className="ml-auto text-xs text-subtle-foreground">{display.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

function NeedsAttention({
  integration,
  all,
  busy,
  onReconnect,
}: {
  integration: IntegrationInfo;
  all: IntegrationInfo[];
  busy: boolean;
  onReconnect: () => void;
}) {
  const target = reconnectTarget(integration, all);
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-cat-error/40 bg-cat-error/6 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CircleAlert className="size-4 text-cat-error" />
        Needs attention
      </h2>
      <p className="text-[13px] leading-relaxed text-soft-foreground">
        <span className="font-mono text-foreground">{integration.name}</span>{' '}
        {describeIntegration(integration).label}
        {integration.errorMessage && <>: {integration.errorMessage}</>}
      </p>
      <div>
        <Button size="sm" onClick={onReconnect} disabled={busy}>
          {target.oauth
            ? `Reconnect ${target.name === integration.name ? '' : target.name}`.trim()
            : 'Retry'}
        </Button>
      </div>
    </section>
  );
}
