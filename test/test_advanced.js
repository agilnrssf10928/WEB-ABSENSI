const http = require('node:http');
const assert = require('node:assert');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyStr); } catch (e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, bodyStr, bodyJson });
      });
    });
    req.on('error', reject);
    if (data) {
      req.setHeader('Content-Type', 'application/json');
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runAdvancedTests() {
  console.log('--- Starting School Advanced Workflow Tests ---');

  // Login Admin
  const adminLogin = await request(
    { hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST' },
    { email: 'admin@sekolah.sch.id', password: 'admin123' }
  );
  const adminToken = adminLogin.bodyJson.token;

  // Login Siswa (Siti Rahmawati)
  const sitiLogin = await request(
    { hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST' },
    { email: 'siti@sekolah.sch.id', password: 'siti123' }
  );
  const sitiToken = sitiLogin.bodyJson.token;

  // 1. Siswa mengajukan dispensasi lomba
  const leaveRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/leaves',
      method: 'POST',
      headers: { Authorization: `Bearer ${sitiToken}` }
    },
    {
      type: 'dispensation',
      start_date: '2026-09-21',
      end_date: '2026-09-23',
      reason: 'Mengikuti Lomba Cerdas Cermat Tingkat Nasional mewakili sekolah'
    }
  );
  assert.strictEqual(leaveRes.statusCode, 200);
  assert(leaveRes.bodyJson.success);
  const leaveId = leaveRes.bodyJson.leave.id;
  console.log('✓ Advanced 1: Student submitted dispensation request (ID:', leaveId, ')');

  // 2. Admin / Guru Piket menyetujui dispensasi
  const approveRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: `/api/leaves/${leaveId}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      status: 'approved',
      admin_notes: 'Disetujui pihak sekolah. Harap membawa nama baik sekolah.'
    }
  );
  assert.strictEqual(approveRes.statusCode, 200);
  assert.strictEqual(approveRes.bodyJson.leave.status, 'approved');
  console.log('✓ Advanced 2: School admin approved student dispensation');

  // 3. Admin mendaftarkan Siswa Baru
  const newStudentRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      nip: '0098765432', // NISN
      name: 'Rian Pratama',
      email: 'rian@sekolah.sch.id',
      password: 'password123',
      department: 'X MIPA 1', // Kelas
      position: 'Siswa',
      phone: '081299988877',
      role: 'student'
    }
  );
  assert.strictEqual(newStudentRes.statusCode, 200);
  assert.strictEqual(newStudentRes.bodyJson.employee.nip, '0098765432');
  const newStudentId = newStudentRes.bodyJson.employee.id;
  console.log('✓ Advanced 3: Admin registered new student Rian Pratama (ID:', newStudentId, ')');

  // 4. Test login dengan akun siswa baru
  const rianLogin = await request(
    { hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST' },
    { email: 'rian@sekolah.sch.id', password: 'password123' }
  );
  assert.strictEqual(rianLogin.statusCode, 200);
  assert.strictEqual(rianLogin.bodyJson.user.name, 'Rian Pratama');
  console.log('✓ Advanced 4: Newly registered student can login successfully');

  // 5. Admin memperbarui pengaturan gerbang sekolah
  const updateSettings = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/settings',
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      office_name: 'SMA Negeri 1 Digital Unggulan',
      work_start_time: '07:00',
      work_end_time: '15:00',
      late_tolerance_minutes: 15,
      office_radius_meters: 200,
      office_lat: -6.2088,
      office_lng: 106.8456,
      enable_radius_restriction: 1
    }
  );
  assert.strictEqual(updateSettings.statusCode, 200);
  assert.strictEqual(updateSettings.bodyJson.settings.office_name, 'SMA Negeri 1 Digital Unggulan');
  console.log('✓ Advanced 5: School settings update verified');

  // 6. Admin menghapus data siswa uji coba
  const deleteRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: `/api/employees/${newStudentId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    }
  );
  assert.strictEqual(deleteRes.statusCode, 200);
  console.log('✓ Advanced 6: Admin successfully deleted test student record');

  console.log('------------------------------------------------');
  console.log('🎉 ALL ADVANCED SCHOOL TESTS PASSED!');
  console.log('------------------------------------------------');
}

runAdvancedTests().catch(e => {
  console.error(e);
  process.exit(1);
});
