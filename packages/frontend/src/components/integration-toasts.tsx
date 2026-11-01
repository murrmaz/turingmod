import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppState } from '@/context/app-state-context';
import { describeIntegration } from '@/lib/integrationStatus';

/** Toasts an integration going into error or needing reauthorization. Renders nothing. */
export function IntegrationToasts() {
  const { integrations } = useAppState();
  const broken = useRef<Set<string> | null>(null);

  useEffect(() => {
    const now = new Set(
      integrations.filter((i) => describeIntegration(i).needsAttention).map((i) => i.name)
    );
    // The first list is how things already were when the console opened, not a change.
    if (broken.current !== null) {
      for (const integration of integrations) {
        if (now.has(integration.name) && !broken.current.has(integration.name)) {
          toast.error(`${integration.name}: ${describeIntegration(integration).label}`, {
            description: integration.errorMessage,
          });
        }
      }
    }
    if (integrations.length > 0) {
      broken.current = now;
    }
  }, [integrations]);

  return null;
}
