import dayjs from 'dayjs';
import { Units } from 'interfaces';
import { LiveData } from 'interfaces/data';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  MutableRefObject,
} from 'react';
import { GlobalLog } from 'utils/logger';
import { useDevice } from './DeviceProvider';

const LOG_LIMIT = 10000;

export type AdditionalData = Partial<{
  speed: Units['kmh'] | null;
}>;

export type LiveDataDatum =
  | (Pick<
      LiveData,
      | 'timestamp'
      | 'timeSinceLastOne'
      | 'voltage'
      | 'current'
      | 'cellVoltageDelta'
      | 'remainingCapacity'
      | 'percentage'
      | 'temperatureProbes'
      | 'balanceCurrent'
    > &
      AdditionalData & {
        // Paused time excluded
        correctedTimestamp: Units['miliseconds'];
      })
  | null;

export type DataLoggerEvent = 'append' | 'replace';

export type DataLoggerContextType = {
  // Mutable on purpose. Never put it in React state, it can hold up to LOG_LIMIT items.
  // Items are only appended (or trimmed from the front) in place; any other change
  // swaps the array and emits 'replace'.
  logRef: MutableRefObject<LiveDataDatum[]>;
  subscribe: (listener: (event: DataLoggerEvent) => void) => () => void;
  // null = not started since last reset
  isPaused: boolean | null;
  stop: () => void;
  start: () => void;
  reset: () => void;
};

const emptyLogRef: MutableRefObject<LiveDataDatum[]> = { current: [] };

// @ts-expect-error
const DataLoggerContext = createContext<DataLoggerContextType>({
  logRef: emptyLogRef,
  subscribe: () => () => undefined,
  isPaused: null,
});

export function useDataLogger() {
  return useContext(DataLoggerContext);
}

type DataLoggerProviderProps = {
  children: ReactNode;
  liveData: LiveData | null;
  additionalData?: AdditionalData;
};

const DataLoggerProvider = ({
  children,
  liveData,
  additionalData = {},
}: DataLoggerProviderProps) => {
  const { status } = useDevice();

  const logRef = useRef<LiveDataDatum[]>([]);
  const listenersRef = useRef(new Set<(event: DataLoggerEvent) => void>());
  // Only flips on first datum / reset, so provider doesn't re-render per frame
  const [hasData, setHasData] = useState(false);
  const [pauseTimestamp, setPauseTimestamp] = useState<Units['miliseconds'] | null>(null);
  const pauseTimestampRef = useRef(pauseTimestamp);
  pauseTimestampRef.current = pauseTimestamp;

  const emit = useCallback((event: DataLoggerEvent) => {
    listenersRef.current.forEach((listener) => listener(event));
  }, []);

  const subscribe = useCallback<DataLoggerContextType['subscribe']>((listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const reset = useCallback(() => {
    logRef.current = [];
    setHasData(false);
    setPauseTimestamp(null);
    emit('replace');
  }, [emit]);

  const stop = useCallback(() => {
    setPauseTimestamp((current) => {
      if (current !== null) {
        GlobalLog.warn(`Data Logger already stopped.`, { current });
        return current;
      } else {
        const now = dayjs().valueOf();
        GlobalLog.info(`Stopping Data Logger`, { now });
        return now;
      }
    });
  }, [setPauseTimestamp]);

  const start = useCallback(() => {
    const lastPauseTimestamp = pauseTimestampRef.current;

    if (lastPauseTimestamp === null) {
      GlobalLog.warn(`Data Logger already started.`, { current: lastPauseTimestamp });
      return;
    }

    setPauseTimestamp(null);

    const timeDifference = dayjs().valueOf() - lastPauseTimestamp;
    GlobalLog.debug(`Correcting Data Log timestamps by pause time ${timeDifference}ms`, {
      timeDifference,
      lastPauseTimestamp,
    });

    // New array so the charts re-parse the shifted timestamps
    logRef.current = logRef.current.map((datum) => {
      if (datum === null) {
        return datum;
      }
      // 3000 to create a small gap
      datum.correctedTimestamp = datum.correctedTimestamp + timeDifference - 3000;
      return datum;
    });
    emit('replace');
  }, [emit]);

  const contextValue = useMemo(
    () => ({
      logRef,
      subscribe,
      isPaused: hasData ? pauseTimestamp !== null : null,
      stop,
      reset,
      start,
    }),
    [hasData, pauseTimestamp, subscribe, stop, reset, start]
  );

  useEffect(() => {
    if (liveData && pauseTimestamp === null) {
      const datum: LiveDataDatum = {
        timestamp: liveData.timestamp,
        correctedTimestamp: liveData.timestamp,
        timeSinceLastOne: liveData.timeSinceLastOne,
        voltage: liveData.voltage,
        current: Math.abs(liveData.current),
        cellVoltageDelta: liveData.cellVoltageDelta,
        remainingCapacity: liveData.remainingCapacity,
        percentage: liveData.percentage,
        temperatureProbes: liveData.temperatureProbes,
        balanceCurrent: liveData.balanceCurrent,
        speed: additionalData?.speed && additionalData?.speed > 1 ? additionalData.speed : null,
      };

      const log = logRef.current;
      log.push(datum);

      if (log.length > LOG_LIMIT) {
        GlobalLog.warn(`For perfomnce reasons flushing old data logs.`);

        // In place, so charts only get a cheap splice notification
        log.splice(0, log.length - (LOG_LIMIT - LOG_LIMIT / 4));
      }

      setHasData(true);
      emit('append');
    }
  }, [liveData, pauseTimestamp]);

  useEffect(() => {
    if (status === 'disconnected') {
      if (logRef.current.length && pauseTimestamp === null) {
        stop();
      }
    } else if (status === 'connected') {
      if (pauseTimestamp !== null) {
        start();
      }
    }
  }, [status]);

  useEffect(() => {
    if (logRef.current.length && pauseTimestamp) {
      logRef.current.push(null);
      emit('append');
    }
  }, [pauseTimestamp]);

  return <DataLoggerContext.Provider value={contextValue}>{children}</DataLoggerContext.Provider>;
};

export default DataLoggerProvider;
