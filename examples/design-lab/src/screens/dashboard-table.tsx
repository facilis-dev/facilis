import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@facilis/ui";
import { Avatar, AvatarStack } from "../components/bits.tsx";
import { RowMenu } from "../components/menu.tsx";
import { formatDate, type Project, type Status } from "../data.ts";
import { IconFolder, IconTrash } from "../icons.tsx";

const STATUS_TONE: Record<Status, "success" | "warning" | "neutral"> = {
  active: "success",
  paused: "warning",
  archived: "neutral",
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

export type DashboardTableProps = {
  projects: readonly Project[];
  onArchive: (project: Project) => void;
  onDelete: (project: Project) => void;
};

/** The data table pattern: name+description, status chip, owner, avatar stack, dates, menu. */
export function DashboardTable({ projects, onArchive, onDelete }: DashboardTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Project</TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">Owner</TableHead>
          <TableHead scope="col" className="lab-col-members">
            Members
          </TableHead>
          <TableHead scope="col" className="lab-col-updated">
            Updated
          </TableHead>
          <TableHead scope="col" className="lab-col-actions">
            <span className="lab-visually-hidden">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell>
              <span className="lab-cell-project">
                <span className="lab-cell-project__name">{project.name}</span>
                <span className="lab-cell-project__desc">{project.description}</span>
              </span>
            </TableCell>
            <TableCell>
              <Badge tone={STATUS_TONE[project.status]} className="lab-badge">
                <span className="lab-status-dot" />
                {STATUS_LABEL[project.status]}
              </Badge>
            </TableCell>
            <TableCell>
              <span className="lab-cell-owner">
                <Avatar name={project.owner.name} size="sm" />
                <span className="lab-cell-owner__name">{project.owner.name}</span>
              </span>
            </TableCell>
            <TableCell className="lab-col-members">
              <AvatarStack names={project.members.map((member) => member.name)} max={3} />
            </TableCell>
            <TableCell className="lab-col-updated">
              <time className="lab-muted lab-tabular" dateTime={project.updatedAt}>
                {formatDate(project.updatedAt)}
              </time>
            </TableCell>
            <TableCell className="lab-col-actions">
              <RowMenu
                label={"Actions for " + project.name}
                items={[
                  {
                    label: "Archive project",
                    icon: <IconFolder />,
                    onSelect: () => onArchive(project),
                  },
                  {
                    label: "Delete project",
                    icon: <IconTrash />,
                    tone: "danger",
                    onSelect: () => onDelete(project),
                  },
                ]}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
