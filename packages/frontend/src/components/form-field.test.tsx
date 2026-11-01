import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './form-field';
import { Input } from './ui/input';

describe('FormField', () => {
  it('labels its control and describes it with the hint', () => {
    render(
      <FormField label="Board address" hint="Use the board's IP address">
        {(field) => <Input {...field} />}
      </FormField>
    );

    expect(screen.getByLabelText('Board address')).toHaveAccessibleDescription(
      "Use the board's IP address"
    );
  });

  it('describes nothing without a hint', () => {
    render(<FormField label="Username">{(field) => <Input {...field} />}</FormField>);

    expect(screen.getByLabelText('Username')).not.toHaveAttribute('aria-describedby');
  });

  it('gives each field its own label, however many there are', () => {
    render(
      <>
        <FormField label="Client ID">{(field) => <Input {...field} defaultValue="id" />}</FormField>
        <FormField label="Client Secret">
          {(field) => <Input {...field} defaultValue="secret" />}
        </FormField>
      </>
    );

    expect(screen.getByLabelText('Client ID')).toHaveValue('id');
    expect(screen.getByLabelText('Client Secret')).toHaveValue('secret');
  });
});
