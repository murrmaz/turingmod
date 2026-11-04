import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { SubscriptionStatus } from '@/hooks/useSubscription';

/**
 * Says in place that what's below failed to load and isn't current, for as long as that lasts,
 * since a toast is gone in seconds and on a second monitor goes unseen. Nothing unless it's failed.
 */
export function SubscriptionFailure({
  status,
  className,
}: {
  status: SubscriptionStatus;
  className?: string;
}) {
  if (status.state !== 'failed') {
    return null;
  }
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlert />
      <AlertTitle>{status.title}</AlertTitle>
      <AlertDescription>
        <p>{status.message}</p>
        <p>Retrying by itself. Anything shown here may be out of date.</p>
      </AlertDescription>
    </Alert>
  );
}
