interface CountdownProps {
  value: number;
  onCancel(): void;
}

export function Countdown(props: CountdownProps) {
  return (
    <button type="button" className="countdown" onClick={props.onCancel} aria-label="Cancel countdown">
      <span key={props.value} className="countdown-num">
        {props.value}
      </span>
      <span className="countdown-hint">tap to cancel</span>
    </button>
  );
}
