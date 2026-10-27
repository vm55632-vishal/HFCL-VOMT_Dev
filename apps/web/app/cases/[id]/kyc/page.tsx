'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import KycPanel from '../../../../components/KycPanel';

export default function KycPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="wrap">
      <nav className="kyc__crumbs" aria-label="Breadcrumb">
        <Link href="/dashboard">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/cases/${id}`}>Case Details</Link>
        <span aria-hidden="true">/</span>
        <strong>Digi KYC &amp; Risk Checks</strong>
      </nav>
      <KycPanel caseId={id} />
    </main>
  );
}
