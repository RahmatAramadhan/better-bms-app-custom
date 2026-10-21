import { useToasts } from '@geist-ui/core';
import { MouseEventHandler, useCallback, useEffect, useState } from 'react';
import { Freeze } from 'react-freeze';
import { useLatest, useLocalStorage } from 'react-use';
import { PREVIOUS_DEVICE_LOCAL_STORAGE_KEY } from 'config/index';
import { JKBMS } from 'devices/jkbms';
import { DEMO_MODE, MockBMS } from 'devices/mock';
import { useWakelock } from 'hooks/useWakelock';
import { DcirMeasurement, DeviceInfoData, LiveData, SettingsData } from 'interfaces/data';
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

// Time after the load is applied at which V and I are sampled for DCIR
const DCIR_SAMPLE_DELAY = 200;
// Give up if no frame arrives
const DCIR_CAPTURE_TIMEOUT = 3000;

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
  const [dcirMeasurement, setDcirMeasurement] = useState<DcirMeasurement | null>(null);
  const [resistanceCaptureActive, setResistanceCaptureActive] = useState(false);
  const captureBaseline = useRef<number[] | null>(null);
  const captureSamples = useRef<
    Array<{ timestamp: number; current: number; voltages: number[] }> | null
  >(null);
  const captureStartedAt = useRef<number>(0);
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
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setResistanceCaptureActive(false);
    if (!baseline || !samples || !samples.length) return;

    // DCIR = (V0 - V@200ms) / I@200ms, using the BMS frame closest to 200ms after the load was applied.
    const startedAt = captureStartedAt.current;
    const sample = samples.reduce((best, candidate) =>
      Math.abs(candidate.timestamp - startedAt - DCIR_SAMPLE_DELAY) <
      Math.abs(best.timestamp - startedAt - DCIR_SAMPLE_DELAY)
        ? candidate
        : best
    );
    const current = Math.abs(sample.current);

    const values = baseline.map((before, cellIndex) => {
      const after = sample.voltages[cellIndex];
      if (!before || !after || current < 0.5 || after >= before) return 0;
      return ((before - after) / current) * 1000;
    });

    const sampleDelay = sample.timestamp - startedAt;
    setDcirMeasurement({ values, sampleDelay, current, measuredAt: Date.now() });
    UILog.info(`DCIR captured from frame ${sampleDelay}ms after load, ${current.toFixed(2)}A`);
  }, []);

  const startResistanceCapture = useCallback(
    (baseline: number[]) => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      captureBaseline.current = baseline;
      captureSamples.current = [];
      captureStartedAt.current = Date.now();
      setResistanceCaptureActive(true);
      captureTimer.current = setTimeout(finishResistanceCapture, DCIR_CAPTURE_TIMEOUT);
    },
    [finishResistanceCapture]
  );

  // Read through the ref so these callbacks stay stable and don't re-render QuickToggles per frame
  const prepareDischargeCapture = useCallback(() => {
    const voltages = liveDataRef.current?.voltages;
    if (voltages) captureBaseline.current = [...voltages];
  }, []);

  const startPreparedDischargeCapture = useCallback(() => {
    if (captureBaseline.current) startResistanceCapture(captureBaseline.current);
  }, [startResistanceCapture]);

  const captureResistanceAgain = useCallback(() => {
    const voltages = liveDataRef.current?.voltages;
    if (voltages) startResistanceCapture([...voltages]);
  }, [startResistanceCapture]);

  useEffect(() => {
    if (!resistanceCaptureActive || !liveData || !captureSamples.current) return;
    // Ignore the frame that was already on screen when the capture started
    if (liveData.timestamp < captureStartedAt.current) return;

    captureSamples.current.push({
      timestamp: liveData.timestamp,
      current: liveData.current,
      voltages: [...liveData.voltages],
    });

    // First frame at/after 200ms: the closest one is either this or the previous one
    if (liveData.timestamp - captureStartedAt.current >= DCIR_SAMPLE_DELAY) {
      finishResistanceCapture();
    }
  }, [liveData, resistanceCaptureActive, finishResistanceCapture]);

  useEffect(() => () => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
  }, []);

  useEffect(() => {
    UILog.info('App rendered');

    const DeviceClass = DEMO_MODE ? MockBMS : JKBMS;
    const newDevice = new DeviceClass({
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
        if (!DEMO_MODE) setPreviousDevice(deviceIdentificator);
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
        setPreviousDevice(null);
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

  useEffect(() => {
    const handlePageHide = () => {
      void device?.disconnect('reset');
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [device]);

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
                  dcir={dcirMeasurement}
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
