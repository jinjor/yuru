interface ModalProps {
  onClose: () => void;
  topOffset: number;
  children: React.ReactNode;
}

export function Modal({ onClose, topOffset, children }: ModalProps) {
  return (
    <div className="modal" style={{ paddingTop: topOffset }}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content">{children}</div>
    </div>
  );
}
