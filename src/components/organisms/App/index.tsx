import { useToasts } from '@geist-ui/core';
import { MouseEventHandler, useCallback, useEffect, useState } from 'react';
import { Freeze } from 'react-freeze';
import { useLatest, useLocalStorage } from 'react-use';
import { PREVIOUS_DEVICE_LOCAL_STORAGE_KEY } from 'config/index';
import { JKBMS } from 'devices/jkbms';
import { useWakelock } from 'hooks/useWakelock';
import { DeviceInfoData, LiveData, SettingsData } from 'interfaces/data';
import { DeviceIdentificator } from 'interfaces/device';
import { UILog } from 'utils/logger';
import BottomNavigation from 'components/molecules/BottomNavigation';
import LogViewer from 'components/molecules/LogViewer';
import QuickToggles from 'components/molecules/QuickToggles';
import TopBar from 'components/molecules/TopBar';
import { useDevice } from 'components/providers/DeviceProvider';
import Summary from 'components/organisms/Summary';
import { AppContainer, ContentContainer } from './styles';
import PageLoader from 'components/atoms/PageLoader';
import DataLoggerProvider, { AdditionalData } from 'components/providers/DataLogger';
import Details from '../Details';
import useWatchSpeed from 'hooks/useWatchSpeed';
import { useRef } from 'react';
import { Units } from 'interfaces';
import { useMemo } from 'react';

export type Screens = 'Logs' | 'Summary' | 'Settings' | 'Details';

const App = () => {
  const [previousDevice, setPreviousDevice] = useLocalStorage<DeviceIdentificator | null>(
    PREVIOUS_DEVICE_LOCAL_STORAGE_KEY,
    null
  );

  const { device, status, setDevice, setStatus } = useDevice();
  const { acquireWakelock, releaseWakelock } = useWakelock();

  const { setToast } = useToasts();

  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const liveDataRef = useLatest(liveData);
  const [deviceInfoData, setDeviceInfoData] = useState<DeviceInfoData | null>(null);
  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
  const [measuredResistances, setMeasuredResistances] = useState<number[] | null>(null);
  const [resistanceCaptureActive, setResistanceCaptureActive] = useState(false);
  const captureBaseline = useRef<number[] | null>(null);
  const captureSamples = useRef<Array<{ current: number; voltages: number[] }> | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedScreen, setSelectedScreen] = useState<Screens>('Logs');

  const speed = useRef<Units['kmh'] | null>(null);
  const handleNewSpeed = useCallback((newSpeed: Units['kmh'] | null) => {
    speed.current = newSpeed;
  }, []);
  useWatchSpeed({ onChange: handleNewSpeed });

  const finishResistanceCapture = useCallback(() => {
    const baseline = captureBaseline.current;
    const samples = captureSamples.current;
    captureBaseline.current = null;
    captureSamples.current = null;
    setResistanceCaptureActive(false);
    if (!baseline || !samples || !samples.length) return;

    const measured = baseline.map((before, cellIndex) => {
      if (!before) return 0;

      // Pair each cell-voltage drop with the current from the same BMS frame.
      // This avoids bias when the load current changes during the capture.
      const resistanceSamples = samples
        .slice(1) // discard the first post-switch frame while the MOSFET/load settles
        .map((sample) => {
          const after = sample.voltages[cellIndex];
          const current = Math.abs(sample.current);
          if (!after || current < 0.5 || after >= before) return null;
          return ((before - after) / current) * 1000;
        })
        .filter((resistance): resistance is number => resistance !== null);

      if (!resistanceSamples.length) return 0;
      return resistanceSamples.reduce((sum, resistance) => sum + resistance, 0) / resistanceSamples.length;
    });
    setMeasuredResistances(measured);
    UILog.info(`Resistance capture complete from ${samples.length - 1} paired samples`);
  }, []);

  const startResistanceCapture = useCallback((baseline: number[]) => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureBaseline.current = baseline;
    captureSamples.current = [];
    setResistanceCaptureActive(true);
    captureTimer.current = setTimeout(finishResistanceCapture, 5000);
  }, [finishResistanceCapture]);

  const prepareDischargeCapture = useCallback(() => {
    if (liveData?.voltages) captureBaseline.current = [...liveData.voltages];
  }, [liveData]);

  const startPreparedDischargeCapture = useCallback(() => {
    if (captureBaseline.current) startResistanceCapture(captureBaseline.current);
  }, [startResistanceCapture]);

  const captureResistanceAgain = useCallback(() => {
    if (liveData?.voltages) startResistanceCapture([...liveData.voltages]);
  }, [liveData, startResistanceCapture]);

  useEffect(() => {
    if (!resistanceCaptureActive || !liveData || !captureSamples.current) return;
    captureSamples.current.push({ current: liveData.current, voltages: [...liveData.voltages] });
  }, [liveData, resistanceCaptureActive]);

  useEffect(() => () => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
  }, []);

  useEffect(() => {
    UILog.info('App rendered');

    const newDevice = new JKBMS({
      onDataReceived(dataType, newData) {
        switch (dataType) {
          case 'LIVE_DATA': {
            setLiveData(newData as LiveData);
            break;
          }
          case 'DEVICE_INFO': {
            setDeviceInfoData(newData as DeviceInfoData);
            break;
          }
          case 'SETTINGS': {
            setSettingsData(newData as SettingsData);
          }
        }
      },
      onStatusChange(newStatus) {
        setStatus(newStatus);
        if (newStatus === 'connecting') {
          setLiveData(null);
          setDeviceInfoData(null);
          setSettingsData(null);
          setSelectedScreen('Summary');
        }
      },
      async onConnected(deviceIdentificator) {
        setPreviousDevice(deviceIdentificator);
        acquireWakelock();
        setSelectedScreen('Summary');
      },
      onDisconnected(reason) {
        if (reason === 'inactivity') {
          setToast({
            type: 'warning',
            text: `Disconnected, Reason: ${reason}`,
            delay: 2000,
          });
        }

        releaseWakelock();

        if (!liveDataRef.current) {
          setSelectedScreen('Logs');
        }
      },
      onError(error) {
        console.error(error);
        setToast({
          type: 'error',
          text: error?.message,
          delay: 2000,
        });
      },
      onRequestDeviceError(error) {
        console.error(error);
        // setToast({
        //   type: 'error',
        //   text: error?.message,
        //   delay: 2000,
        // });
      },
      onPreviousUnavailable() {
        setPreviousDevice(null);
        setToast({
          type: 'warning',
          text: `Previous device unavailable. Tap again.`,
          delay: 3000,
        });
      },
    });

    setDevice(newDevice);

    return () => {
      newDevice.disconnect('reset');
    };
  }, [setStatus, setDevice]);

  const handleClickAnywhere = useCallback<MouseEventHandler>(
    (ev) => {
      if (status === 'disconnected') {
        ev.stopPropagation();
        device?.connect({
          previous: previousDevice ?? undefined,
        });
      }
    },
    [status, device]
  );

  const additionalDataLoggerData = useMemo<AdditionalData>(
    () => ({ speed: speed.current }),
    [speed.current]
  );

  return (
    <DataLoggerProvider liveData={liveData} additionalData={additionalDataLoggerData}>
      <AppContainer onClick={handleClickAnywhere}>
        <TopBar deviceInfoData={deviceInfoData} liveData={liveData} />
        {status === 'connected' && (
          <QuickToggles
            settingsData={settingsData}
            onDischargePrepare={prepareDischargeCapture}
            onDischargeCapture={startPreparedDischargeCapture}
            onCaptureResistance={captureResistanceAgain}
            captureActive={resistanceCaptureActive}
            captureReady={Boolean(liveData?.voltages)}
          />
        )}

        <ContentContainer>
          <Freeze freeze={selectedScreen !== 'Logs'}>
            <LogViewer />
          </Freeze>

          {liveData ? (
            <>
              <Freeze freeze={selectedScreen !== 'Summary'}>
                <Summary liveData={liveData} speed={speed.current} />
              </Freeze>
              <Freeze freeze={selectedScreen !== 'Details'}>
                <Details
                  liveData={liveData}
                  measuredResistances={measuredResistances}
                  resistanceCaptureActive={resistanceCaptureActive}
                />
              </Freeze>
            </>
          ) : (
            selectedScreen !== 'Logs' && <PageLoader />
          )}
        </ContentContainer>

        <BottomNavigation selectedScreen={selectedScreen} setSelectedScreen={setSelectedScreen} />
      </AppContainer>
    </DataLoggerProvider>
  );
};

export default App;
