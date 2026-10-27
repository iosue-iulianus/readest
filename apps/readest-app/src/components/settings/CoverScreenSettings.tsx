import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useCoverScreenStatus } from '@/hooks/useCoverScreen';
import { saveSysSettings } from '@/helpers/settings';
import type { LibraryCoverFitType } from '@/types/settings';
import { SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';

/** Foldable outer screen rows for the Device section (Android only). */
const CoverScreenSettings: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const [enabled, setEnabled] = useState(settings.coverScreenEnabled);
  const [dim, setDim] = useState(settings.coverScreenDim);
  const [fit, setFit] = useState(settings.coverScreenFit);
  const status = useCoverScreenStatus(!!appService?.isAndroidApp);
  // Greyed out until the probe answers, and for good on devices without an outer screen.
  const supported = !!status?.supported;

  if (!appService?.isAndroidApp) return null;

  const dimOptions = [
    { value: '0', label: _('Off') },
    { value: '25', label: '25%' },
    { value: '50', label: '50%' },
    { value: '75', label: '75%' },
  ];
  const fitOptions = [
    { value: 'fit', label: _('Fit') },
    { value: 'crop', label: _('Crop') },
  ];

  return (
    <>
      <SettingsSwitchRow
        label={_('Cover Screen')}
        description={
          status && !supported
            ? _('Not available on this device')
            : _('On foldables, show the book cover on the outer screen')
        }
        checked={enabled}
        disabled={!supported}
        onChange={() => {
          setEnabled(!enabled);
          void saveSysSettings(envConfig, 'coverScreenEnabled', !enabled);
        }}
        data-setting-id='settings.control.coverScreen'
      />
      {supported && (
        <SettingsRow
          label={_('Cover Screen Fit')}
          disabled={!enabled}
          data-setting-id='settings.control.coverScreenFit'
        >
          <SettingsSelect
            value={fit}
            onChange={(e) => {
              const next = e.target.value as LibraryCoverFitType;
              setFit(next);
              void saveSysSettings(envConfig, 'coverScreenFit', next);
            }}
            ariaLabel={_('Cover Screen Fit')}
            disabled={!enabled}
            options={fitOptions}
          />
        </SettingsRow>
      )}
      {supported && (
        <SettingsRow
          label={_('Cover Screen Dimming')}
          disabled={!enabled}
          data-setting-id='settings.control.coverScreenDim'
        >
          <SettingsSelect
            value={String(dim)}
            onChange={(e) => {
              const next = Number(e.target.value);
              setDim(next);
              void saveSysSettings(envConfig, 'coverScreenDim', next);
            }}
            ariaLabel={_('Cover Screen Dimming')}
            disabled={!enabled}
            options={dimOptions}
          />
        </SettingsRow>
      )}
    </>
  );
};

export default CoverScreenSettings;
