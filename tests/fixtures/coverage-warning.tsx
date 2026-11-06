import { createRoot } from "react-dom/client";
import { RequestsKanbanPage } from "../../src/components/modules/requests-kanban-page";
import { MySchedulePage } from "../../src/components/modules/my-schedule-page";

createRoot(document.getElementById("root")!).render(
  location.search.includes("personal") ? <MySchedulePage /> : <RequestsKanbanPage />
);
