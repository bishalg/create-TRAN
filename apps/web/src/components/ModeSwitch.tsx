import { type SupportedLocale, t } from '@tran/core';

export type CheckMode = 'device' | 'server';

const OPTIONS: { value: CheckMode; title: string; hint: string }[] = [
  { value: 'device', title: 'app.modeDevice', hint: 'app.modeDeviceHint' },
  { value: 'server', title: 'app.modeServer', hint: 'app.modeServerHint' },
];

export interface ModeSwitchProps {
  mode: CheckMode;
  onChange: (mode: CheckMode) => void;
  locale: SupportedLocale;
}

/** Native radio inputs: keyboard (arrows), focus and screen-reader behaviour come for free. */
export function ModeSwitch({ mode, onChange, locale }: ModeSwitchProps) {
  return (
    <fieldset className="choice-group">
      <legend>{t('app.modeLegend', locale)}</legend>
      {OPTIONS.map(({ value, title, hint }) => (
        <label key={value} className="choice">
          <input
            type="radio"
            name="check-mode"
            value={value}
            checked={mode === value}
            onChange={() => onChange(value)}
          />
          <span className="choice-title">{t(title, locale)}</span>
          <span className="choice-hint">{t(hint, locale)}</span>
        </label>
      ))}
    </fieldset>
  );
}
