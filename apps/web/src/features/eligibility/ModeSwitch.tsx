import { type SupportedLocale, t } from '@tran/core';
import { TranLabel } from '../../shared/ui/TranLabel.js';
import { TranText } from '../../shared/ui/TranText.js';
import type { CheckMode } from './toView.js';

const OPTIONS: { value: CheckMode; title: string; hint: string }[] = [
  { value: 'device', title: 'app.modeDevice', hint: 'app.modeDeviceHint' },
  { value: 'server', title: 'app.modeServer', hint: 'app.modeServerHint' },
];

export interface ModeSwitchProps {
  mode: CheckMode;
  onChange: (mode: CheckMode) => void;
  locale: SupportedLocale;
}

/** Native radios: arrow-key navigation, focus and screen-reader semantics come for free. */
export function ModeSwitch({ mode, onChange, locale }: ModeSwitchProps) {
  return (
    <fieldset className="choice-group">
      <legend>{t('app.modeLegend', locale)}</legend>
      {OPTIONS.map(({ value, title, hint }) => (
        <TranLabel key={value} className="choice">
          <input
            type="radio"
            name="check-mode"
            value={value}
            checked={mode === value}
            onChange={() => onChange(value)}
          />
          <TranText variant="body" as="span" className="choice-title">
            {t(title, locale)}
          </TranText>
          <TranText variant="caption" as="span" className="choice-hint">
            {t(hint, locale)}
          </TranText>
        </TranLabel>
      ))}
    </fieldset>
  );
}
