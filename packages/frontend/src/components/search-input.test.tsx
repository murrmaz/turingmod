import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SearchInput } from './search-input';

const search = () => screen.getByPlaceholderText('Search');

describe('SearchInput', () => {
  it('takes focus on /, which is not typed into it', async () => {
    const user = userEvent.setup();
    render(<SearchInput placeholder="Search" />);

    await user.keyboard('/');

    expect(search()).toHaveFocus();
    expect(search()).toHaveValue('');
  });

  it('leaves / alone while something else is being typed into', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SearchInput placeholder="Search" />
        <input aria-label="Other" />
      </>
    );

    await user.click(screen.getByLabelText('Other'));
    await user.keyboard('/');

    expect(screen.getByLabelText('Other')).toHaveValue('/');
    expect(search()).not.toHaveFocus();
  });

  it('stays out of the way of a dialog open over it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SearchInput placeholder="Search" />
        <div role="dialog" aria-label="Over it">
          <button type="button">In the dialog</button>
        </div>
      </>
    );

    await user.click(screen.getByRole('button', { name: 'In the dialog' }));
    await user.keyboard('/');

    expect(search()).not.toHaveFocus();
  });

  it('leaves a shortcut with a modifier alone', async () => {
    const user = userEvent.setup();
    render(<SearchInput placeholder="Search" />);

    await user.keyboard('{Control>}/{/Control}');

    expect(search()).not.toHaveFocus();
  });
});
