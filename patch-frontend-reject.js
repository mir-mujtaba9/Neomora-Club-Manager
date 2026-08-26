const fs = require('fs');
const file = 'D:\\san9\\web work\\neomora-club-manager(frontend)\\src\\pages\\super-admin\\RegistrationRequests.tsx';
let code = fs.readFileSync(file, 'utf8');

// Add state for reject modal
code = code.replace(
  "const [reviewing, setReviewing] = useState<RegistrationRequest | null>(null);",
  "const [reviewing, setReviewing] = useState<RegistrationRequest | null>(null);\n  const [rejecting, setRejecting] = useState<RegistrationRequest | null>(null);\n  const [rejectReason, setRejectReason] = useState('');"
);

// Update reject button in the list to open modal instead
code = code.replace(
  "onClick={() => reject(req)}",
  "onClick={() => { setRejecting(req); setRejectReason(''); }}"
);

// Update the actual reject function to hit API
const oldRejectFn = `  function reject(req: RegistrationRequest) {
    updateRequest(req.id, { status: "rejected" });
    success("Request rejected");
  }`;

const newRejectFn = `  async function handleReject() {
    if (!rejecting) return;
    try {
      await apiClient.patch(\`/participants/\${rejecting.id}/status\`, { 
        status: 'WITHDRAWN', 
        reason: rejectReason || 'Rejected by admin' 
      });
      setRequests(prev => prev.filter(r => r.id !== rejecting.id));
      success('Request rejected and email sent to guardian.');
      setRejecting(null);
    } catch (e: any) {
      error(e.response?.data?.message || 'Failed to reject request');
    }
  }`;

code = code.replace(oldRejectFn, newRejectFn);

// Add Reject Modal to JSX
const rejectModal = `
      {/* Reject Modal */}
      <Modal
        isOpen={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject Registration"
      >
        <div className="space-y-4 py-2">
          <p className="text-sm text-text-muted">
            Please provide a reason for rejecting <strong>{rejecting?.studentName}</strong>'s registration. This will be sent to the guardian via email.
          </p>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text">Rejection Reason</label>
            <textarea
              className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm text-text focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-text-muted/50"
              rows={4}
              placeholder="e.g., We are currently at full capacity for this age group..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-4">
            <button
              onClick={() => setRejecting(null)}
              className="px-4 py-2 bg-surface-muted text-text-muted hover:text-text rounded-md text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleReject}
              disabled={!rejectReason.trim()}
              className="px-4 py-2 bg-danger text-white rounded-md text-sm font-medium hover:bg-danger/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reject & Send Email
            </button>
          </div>
        </div>
      </Modal>
`;

code = code.replace(
  "{reviewing && (",
  rejectModal + "\n      {reviewing && ("
);

fs.writeFileSync(file, code);
