import { EmployeeProfilePage } from "@/components/employee-profile-page";

export default function PerfilColaboradorRoute({ params }: { params: { employeeId: string } }) {
  return <EmployeeProfilePage employeeId={params.employeeId} />;
}
