import classNames from 'classnames';
import React, { memo, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { liveDataUIConfig } from 'config/uiConfig';
import { DcirMeasurement, LiveData } from 'interfaces/data';
import { formatValue } from 'utils/formatValue';
import LineChart from 'components/molecules/LineChart';
import { CellsGrid, DetailsContainer, InfoGrid, SectionNote, SectionTitle } from './styles';

type DetailsProps = {
  liveData: LiveData;
  dcir?: DcirMeasurement | null;
  resistanceCaptureActive?: boolean;
};

const EMPTY_VALUE = '\xa0-\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0';

const Details = ({ liveData, dcir, resistanceCaptureActive }: DetailsProps) => {
  const lowestVol = useMemo(
    () => (liveData.voltages ? Math.min(...liveData.voltages.filter((v) => v !== 0)) : 0),
    [liveData]
  );
  const highestVol = useMemo(
    () => (liveData.voltages ? Math.max(...liveData.voltages) : 0),
    [liveData]
  );

  const dcirStats = useMemo(() => {
    const measured = dcir?.values.filter((v) => v > 0) ?? [];
    if (!dcir || !measured.length) return null;

    return {
      average: measured.reduce((sum, v) => sum + v, 0) / measured.length,
      lowest: Math.min(...measured),
      highest: Math.max(...measured),
    };
  }, [dcir]);

  return (
    <DetailsContainer>
      <ErrorBoundary fallback={<div />}>
        <LineChart duration={1000 * 60 * 30} frameRate={1} showXAxisLabels showGridLines />
      </ErrorBoundary>

      <InfoGrid>
        {formatValue(
          liveData,
          'temperatureProbes',
          liveData.temperatureProbes?.[0],
          'T controller'
        )}
        {formatValue(liveData, 'temperatureProbes', liveData.temperatureProbes?.[1], 'T positive')}

        {Object.entries(liveData || {})
          .filter(([key, name]) => Object.hasOwn(liveDataUIConfig, key) && typeof name !== 'object')
          // @ts-ignore
          .map(([name, value]: [string, number]) => (
            <React.Fragment key={name}>
              {
                // @ts-ignore
                formatValue(liveData, name, value)
              }
            </React.Fragment>
          ))}
      </InfoGrid>

      <CellsGrid>
        {liveData.voltages?.map((voltage, i) => (
          <span
            key={i}
            className={classNames(
              liveData.cellVoltageDelta > 0.004 &&
                voltage !== 0 &&
                (voltage === lowestVol ? 'lowest' : voltage === highestVol ? 'highest' : '')
            )}
          >
            {`${String(i + 1).padStart(2, '0')}: ${
              voltage ? voltage.toFixed(3) : '\xa0-\xa0\xa0\xa0\xa0\xa0\xa0\xa0\xa0'
            }`}
          </span>
        ))}
      </CellsGrid>

      <SectionTitle>{'DCIR (mΩ)'}</SectionTitle>
      {dcir ? (
        <>
          <SectionNote>
            {resistanceCaptureActive
              ? 'Measuring...'
              : `(V0 − V${Math.round(dcir.sampleDelay)}ms) / I${Math.round(
                  dcir.sampleDelay
                )}ms · ${dcir.current.toFixed(1)}A`}
            {dcirStats && !resistanceCaptureActive
              ? ` · avg ${dcirStats.average.toFixed(2)} mΩ`
              : ''}
          </SectionNote>
          <CellsGrid>
            {dcir.values.map((value, i) => (
              <span
                key={i}
                className={classNames(
                  dcirStats &&
                    dcirStats.highest !== dcirStats.lowest &&
                    value > 0 &&
                    (value === dcirStats.highest
                      ? 'highest'
                      : value === dcirStats.lowest
                      ? 'lowest'
                      : '')
                )}
              >
                {`${String(i + 1).padStart(2, '0')}: ${value ? value.toFixed(2) : EMPTY_VALUE}`}
              </span>
            ))}
          </CellsGrid>
        </>
      ) : (
        <SectionNote>
          {resistanceCaptureActive
            ? 'Measuring...'
            : 'Not measured yet. Switch Discharge on or tap Capture resistance.'}
        </SectionNote>
      )}

      {liveData.resistances && (
        <>
          <SectionTitle>{'Wire resistance (BMS, Ω)'}</SectionTitle>
          <CellsGrid>
            {liveData.resistances.map((resistance, i) => (
              <span key={i}>
                {`${String(i + 1).padStart(2, '0')}: ${
                  resistance ? resistance.toFixed(3) : EMPTY_VALUE
                }`}
              </span>
            ))}
          </CellsGrid>
        </>
      )}
    </DetailsContainer>
  );
};

export default memo(Details);
