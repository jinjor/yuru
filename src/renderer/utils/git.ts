export function statusColor(status: string): string {
  switch (status) {
    case "M":
      return "#e2c08d";
    case "A":
    case "R":
    case "??":
      return "#73c991";
    case "D":
      return "#c74e39";
    default:
      return "#888";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "??":
      return "U";
    default:
      return status;
  }
}

export function treeStatusClass(status?: string): string {
  switch (status) {
    case "M":
      return "modified";
    case "A":
    case "R":
    case "??":
      return "added";
    default:
      return "";
  }
}
