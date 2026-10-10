import { plainToInstance, Transform } from 'class-transformer';
import { validate, IsBooleanString, IsOptional } from 'class-validator';
import { lastValueTransformer } from './last-value.transformer';

class CheckboxForm {
  @IsOptional()
  @Transform(lastValueTransformer)
  @IsBooleanString()
  active?: string;
}

describe('lastValueTransformer', () => {
  const parse = (active: unknown) => plainToInstance(CheckboxForm, { active });

  it('should keep the checkbox value when the box is ticked', async () => {
    const form = parse(['false', 'true']);
    expect(form.active).toBe('true');
    expect(await validate(form)).toHaveLength(0);
  });

  it('should keep the hidden fallback when the box is unticked', async () => {
    const form = parse('false');
    expect(form.active).toBe('false');
    expect(await validate(form)).toHaveLength(0);
  });

  it('should leave a missing value missing', () => {
    expect(parse(undefined).active).toBeUndefined();
  });
});
