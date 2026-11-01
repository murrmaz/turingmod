import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Deferred, deferred, FakeSubscription } from '@/testing/fakeTrpc';
import { consoleWrapper } from '@/testing/renderConsole';
import { type Suggestion, useSuggestions } from './useSuggestions';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
);
vi.mock('sonner', () => ({ toast }));

/** What the hook gave sonner for its most recent toast: the Undo action and the close callbacks. */
interface UndoToast {
  id: string;
  action: { onClick: () => void };
  onAutoClose: () => void;
  onDismiss: () => void;
}

function lastToast(): UndoToast {
  const call = toast.mock.lastCall;
  if (!call) {
    throw new Error('No toast was shown');
  }
  return call[1] as UndoToast;
}

function suggestion(id: number): Suggestion {
  return { id, suggestion: `idea ${id}`, suggestedBy: 'viewer', createdAt: id };
}

const ALL = [suggestion(1), suggestion(2), suggestion(3)];

function setup() {
  const watch = new FakeSubscription<Suggestion[]>();
  const answers: Deferred<Suggestion[]>[] = [];
  const mutate = vi.fn((_input: { ids: number[] }) => {
    const answer = deferred<Suggestion[]>();
    answers.push(answer);
    return answer.promise;
  });
  const hook = renderHook(() => useSuggestions(), {
    wrapper: consoleWrapper({ procedures: { suggestions: { watch, delete: { mutate } } } }),
  });
  watch.emit(ALL);
  const ids = () => hook.result.current.suggestions.map((s) => s.id);
  /** Answer the delete sent `index`th, as the backend would. */
  const answer = async (index: number, result: Suggestion[] | Error) => {
    const pending = answers[index];
    if (!pending) {
      throw new Error(`No delete #${index} was sent`);
    }
    // Async, so the hook's handlers for the answer run (and render) before this returns.
    await act(async () => {
      if (result instanceof Error) {
        pending.reject(result);
      } else {
        pending.resolve(result);
      }
      await pending.promise.catch(() => undefined);
    });
  };
  return { ...hook, watch, mutate, ids, answer };
}

describe('useSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides deleted suggestions at once, without sending the delete yet', () => {
    const { result, ids, mutate } = setup();

    act(() => result.current.remove([1]));

    expect(ids()).toEqual([2, 3]);
    expect(toast).toHaveBeenCalledWith('Deleting 1 suggestion…', expect.anything());
    expect(mutate).not.toHaveBeenCalled();
  });

  it('brings them back on Undo, and sends nothing when the toast then closes', () => {
    const { result, ids, mutate } = setup();
    act(() => result.current.remove([1, 2]));
    const undoToast = lastToast();

    act(() => undoToast.action.onClick());
    act(() => undoToast.onDismiss());

    expect(ids()).toEqual([1, 2, 3]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('sends the delete when the toast closes, and shows the list the backend answers with', async () => {
    const { result, ids, mutate, answer } = setup();
    act(() => result.current.remove([1]));

    act(() => lastToast().onAutoClose());

    expect(mutate).toHaveBeenCalledWith({ ids: [1] });
    await answer(0, [suggestion(2), suggestion(3)]);
    expect(ids()).toEqual([2, 3]);
  });

  it('keeps them hidden while the delete is on its way, whatever the subscription sends', () => {
    const { result, ids, watch } = setup();
    act(() => result.current.remove([1]));
    act(() => lastToast().onAutoClose());

    // Another console's change arrives before this delete is answered, still listing it.
    watch.emit([...ALL, suggestion(4)]);

    expect(ids()).toEqual([2, 3, 4]);
  });

  it('keeps them hidden while the delete is on its way, though another delete is undone', () => {
    const { result, ids } = setup();
    act(() => result.current.remove([1]));
    act(() => lastToast().onAutoClose());
    act(() => result.current.remove([2]));

    act(() => lastToast().action.onClick());

    expect(ids()).toEqual([2, 3]);
  });

  it('sends once, though the toast both closes by itself and is dismissed', () => {
    const { result, mutate } = setup();
    act(() => result.current.remove([1]));
    const undoToast = lastToast();

    act(() => undoToast.onAutoClose());
    act(() => undoToast.onDismiss());

    expect(mutate).toHaveBeenCalledOnce();
  });

  it('ignores Undo once the delete has been sent', () => {
    const { result, ids } = setup();
    act(() => result.current.remove([1]));
    const undoToast = lastToast();

    act(() => undoToast.onAutoClose());
    act(() => undoToast.action.onClick());

    expect(ids()).toEqual([2, 3]);
  });

  it('puts them back and says so when the delete fails', async () => {
    const { result, ids, answer } = setup();
    act(() => result.current.remove([1, 2]));
    act(() => lastToast().onAutoClose());

    await answer(0, new Error('database is locked'));

    expect(ids()).toEqual([1, 2, 3]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't delete 2 suggestions", {
      description: 'database is locked',
    });
  });

  it('sends every delete still waiting when the page is left, closing their toasts', () => {
    const { result, mutate, unmount } = setup();
    act(() => result.current.remove([1]));
    const first = lastToast().id;
    act(() => result.current.remove([2, 3]));
    const second = lastToast().id;

    unmount();

    expect(mutate.mock.calls.map(([input]) => input)).toEqual([{ ids: [1] }, { ids: [2, 3] }]);
    expect(toast.dismiss).toHaveBeenCalledWith(first);
    expect(toast.dismiss).toHaveBeenCalledWith(second);
  });

  it('does nothing for an empty selection', () => {
    const { result, ids } = setup();

    act(() => result.current.remove([]));

    expect(toast).not.toHaveBeenCalled();
    expect(ids()).toEqual([1, 2, 3]);
  });
});
