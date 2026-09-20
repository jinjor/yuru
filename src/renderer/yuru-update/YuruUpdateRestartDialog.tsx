import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface YuruUpdateRestartDialogProps {
  onCancel: () => void;
  onRestart: () => void;
}

// 作業中の session を巻き込む時だけ出す確認。何が動いているかは左ペインに見えているので、
// ここには書かない。
export function YuruUpdateRestartDialog({ onCancel, onRestart }: YuruUpdateRestartDialogProps) {
  return (
    <Modal onClose={onCancel} topOffset={160}>
      <div className="yuru-update-dialog">
        <div className="yuru-update-dialog-head">
          <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
          <span>Restart to update</span>
        </div>
        <div className="yuru-update-dialog-body">
          <p>A session is still working. Restarting stops it.</p>
        </div>
        <div className="yuru-update-dialog-foot">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onRestart}>
            Restart
          </Button>
        </div>
      </div>
    </Modal>
  );
}
