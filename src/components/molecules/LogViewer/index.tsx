import Logger, { ILogLevel } from 'js-logger';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { consoleHandler, GlobalLog, LOG_SCOPES, UILog } from 'utils/logger';
import LogItem from './LogItem';
import { LogCount, LogViewerContainer, ScrollContainer } from './styles';

export type LogType = [number, string, ILogLevel['name'], LOG_SCOPES, string];
type PendingLog = LogType extends [number, ...infer Rest] ? Rest : never;

const LogViewer = () => {
  const isHandlerSet = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollLockTimeout = useRef<ReturnType<typeof setTimeout> | null | undefined>(undefined);
  const ignoreScrolls = useRef<number>(0);
  const [logs, setLogs] = useState<LogType[]>(() => []);

  // Decoding logs several lines per BMS frame. Buffer them and render in batches
  // instead of re-rendering the whole list for every single line.
  const pendingLogs = useRef<PendingLog[]>([]);
  const nextKey = useRef(1);
  const flushTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLogs = useCallback(() => {
    flushTimeout.current = null;
    const pending = pendingLogs.current;
    pendingLogs.current = [];
    if (!pending.length) return;

    setLogs((current) => {
      const added = pending.map((rest) => [nextKey.current++, ...rest] as LogType);

      if (current.length + added.length > 500) {
        UILog.info(`For performance reasons flushing ${500 - 100} oldest logs`);
        return [...current, ...added].slice(-400);
      }

      return [...current, ...added];
    });
  }, [setLogs]);

  const addLog = useCallback(
    (date: string, level: ILogLevel['name'], scope: LOG_SCOPES, message: string) => {
      pendingLogs.current.push([date, level, scope, message]);

      if (flushTimeout.current === null) {
        flushTimeout.current = setTimeout(flushLogs, 250);
      }
    },
    [flushLogs]
  );

  useEffect(
    () => () => {
      if (flushTimeout.current !== null) {
        clearTimeout(flushTimeout.current);
      }
    },
    []
  );

  useLayoutEffect(() => {
    if (typeof scrollLockTimeout.current !== 'number' && scrollContainerRef.current) {
      ignoreScrolls.current += 1;
      scrollContainerRef.current.scrollTo(0, scrollContainerRef.current.scrollHeight);
    }
  }, [logs]);

  const handleScroll = useCallback<React.UIEventHandler<HTMLDivElement>>(() => {
    if (ignoreScrolls.current === 0) {
      if (scrollLockTimeout.current) {
        clearTimeout(scrollLockTimeout.current);
      }

      scrollLockTimeout.current = setTimeout(() => (scrollLockTimeout.current = null), 10000);
    } else if (ignoreScrolls.current > 0) {
      ignoreScrolls.current -= 1;
    }
  }, []);

  useLayoutEffect(() => {
    if (!isHandlerSet.current) {
      GlobalLog.log('Initializing Log viewer');

      Logger.setHandler((originalMessages, context) => {
        const { date, scope } = consoleHandler(originalMessages, context);

        addLog(date, context.level.name.toLowerCase(), scope, originalMessages[0].toString());
      });

      isHandlerSet.current = true;
    }
  }, []);

  useEffect(() => {
    GlobalLog.log('Log Viewer initialized');
  }, []);

  return (
    <LogViewerContainer>
      <LogCount>{`Log count: ${logs.length}`}</LogCount>
      <ScrollContainer ref={scrollContainerRef} onScroll={handleScroll}>
        {logs.map((log) => (
          <LogItem log={log} key={log[0]} />
        ))}
      </ScrollContainer>
    </LogViewerContainer>
  );
};

export default memo(LogViewer);
