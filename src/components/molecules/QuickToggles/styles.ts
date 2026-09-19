import styled from 'styled-components';

export const QuickTogglesContainer = styled.div`
  width: 100%;
  padding: 4px 16px;
  display: flex;
  justify-content: space-evenly;
  gap: 30px;
`;

export const ToggleLabel = styled.label`
  width: 75px;
  text-align: right;
`;

export const ToggleWithLabel = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;

  label:last-child {
    height: auto !important;
  }

  &:nth-child(2n) {
    flex-direction: row-reverse;

    ${ToggleLabel} {
      text-align: left;
    }
  }
`;

export const CaptureButton = styled.button`
  border: 1px solid ${({ theme }) => theme.accents_7};
  border-radius: 6px;
  background: transparent;
  color: ${({ theme }) => theme.accents_7};
  padding: 4px 8px;
  font: inherit;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;
