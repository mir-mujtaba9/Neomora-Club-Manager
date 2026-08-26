const fs = require('fs');
const file = 'D:\\san9\\web work\\neomora-club-manager(frontend)\\src\\pages\\parent\\ChildProfile.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  "import { useParams, Link } from 'react-router-dom';",
  "import { useParams, Link } from 'react-router-dom';\nimport { apiClient } from '../../lib/apiClient';"
);

code = code.replace(
  "import { useMemo, useState, useRef } from 'react';",
  "import { useMemo, useState, useRef, useEffect } from 'react';"
);

const oldLogicStart = "  const student = familyStudents.find((s) => s.id === studentId);";
const oldLogicEnd = "  }, [studentSessions]);";

const startIndex = code.indexOf(oldLogicStart);
const endIndex = code.indexOf(oldLogicEnd) + oldLogicEnd.length;

if (startIndex > -1 && endIndex > -1) {
  const newLogic = `  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/guardians/dashboard')
      .then(res => {
        const found = res.data.students.find((s: any) => s.id === studentId);
        if (found) setStudent(found);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [studentId]);

  let paymentStatus = 'No Invoice';
  if (student) {
    if (student.invoices?.overdue?.length > 0 || student.invoices?.upcoming?.length > 0) paymentStatus = 'Unpaid';
    else if (student.invoices?.paid?.length > 0) paymentStatus = 'Paid';
  }

  const studentSessions: any[] = [];
  const grid = new Map();
  const allHistory: any[] = [];
  const location = student ? { name: student.location } : null;
  const cohort = student ? { label: student.status } : null;`;

  code = code.substring(0, startIndex) + newLogic + code.substring(endIndex);
}

code = code.replace(/student\.name/g, "\`\${student?.firstNameEn || ''} \${student?.lastNameEn || ''}\`");
code = code.replace(/student\.dob/g, "student?.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'Unknown'");
code = code.replace("if (!student)", "if (!student && !loading)");

fs.writeFileSync(file, code);
