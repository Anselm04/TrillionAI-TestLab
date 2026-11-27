import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

void main() => runApp(const TestLabApp());

class TestLabApp extends StatelessWidget {
  const TestLabApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'TrillionAI TestLab',
    theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
    home: const TestLabHome(),
  );
}

Uri apiUri(String endpoint, String path) {
  final uri = Uri.parse(endpoint.trim());
  if (!uri.hasAuthority || uri.userInfo.isNotEmpty || uri.hasQuery ||
      uri.hasFragment || (uri.path.isNotEmpty && uri.path != '/') ||
      !(uri.scheme == 'https' || (uri.scheme == 'http' &&
      ['127.0.0.1', 'localhost', '::1'].contains(uri.host)))) {
    throw const FormatException('Use a secure API origin or local loopback');
  }
  return uri.replace(path: path);
}

class FarmSnapshot {
  const FarmSnapshot(this.status, this.devices);
  final String status;
  final List<Map<String, dynamic>> devices;
  factory FarmSnapshot.parse(Object? data) {
    if (data is! Map<String, dynamic> || data['status'] is! String ||
        data['devices'] is! List) {
      throw const FormatException('Invalid inventory');
    }
    final devices = <Map<String, dynamic>>[];
    for (final item in data['devices'] as List) {
      if (item is! Map<String, dynamic> || item['id'] is! String ||
          item['available'] is! bool) {
        throw const FormatException('Invalid device');
      }
      devices.add(item);
    }
    return FarmSnapshot(data['status'] as String, devices);
  }
  int get available => devices.where((d) => d['available'] == true).length;
  int get quarantined => devices.where((d) =>
      (d['leaseState'] ?? d['state']) == 'QUARANTINED').length;
}

class CapabilitySnapshot {
  const CapabilitySnapshot(this.domains);
  final List<Map<String, dynamic>> domains;
  factory CapabilitySnapshot.parse(Object? data) {
    if (data is! Map<String, dynamic> || data['schemaVersion'] != 1 ||
        data['scope'] != 'DECLARED_LOCAL_RUNNER' ||
        data['productionReady'] != false || data['domains'] is! List) {
      throw const FormatException('Invalid capability catalog');
    }
    final domains = <Map<String, dynamic>>[];
    final ids = <String>{};
    for (final item in data['domains'] as List) {
      if (item is! Map<String, dynamic> || item['id'] is! String ||
          item['label'] is! String || item['runStatus'] != 'NOT_EXECUTED' ||
          !['PARTIAL', 'NOT_IMPLEMENTED'].contains(item['implementationStatus']) ||
          !ids.add(item['id'] as String)) {
        throw const FormatException('Invalid capability domain');
      }
      domains.add(Map<String, dynamic>.unmodifiable(item));
    }
    if (domains.isEmpty) throw const FormatException('Empty capability catalog');
    return CapabilitySnapshot(List<Map<String, dynamic>>.unmodifiable(domains));
  }
  int get partial => domains.where((d) => d['implementationStatus'] == 'PARTIAL').length;
}

String reportPath(String value) {
  final id = value.trim();
  if (!RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$').hasMatch(id)) {
    throw const FormatException('Invalid report ID');
  }
  return '/runs/$id';
}

class RunReportSnapshot {
  const RunReportSnapshot(this.data);
  final Map<String, dynamic> data;
  factory RunReportSnapshot.parse(Object? value, {String? expectedId}) {
    if (value is! Map<String, dynamic> || value['schemaVersion'] != 1 ||
        value['id'] is! String || value['project'] is! String ||
        value['productionReady'] != false ||
        !['PASSED', 'FAILED', 'TIMEOUT', 'INFRASTRUCTURE_ERROR', 'NOT_EXECUTED'].contains(value['status']) ||
        value['observations'] is! List) {
      throw const FormatException('Invalid run report');
    }
    final id = value['id'] as String;
    if (reportPath(id) != '/runs/$id' || (expectedId != null && id != expectedId)) {
      throw const FormatException('Report ID mismatch');
    }
    final observations = value['observations'] as List;
    if (observations.length != 1 || observations.first is! Map<String, dynamic> ||
        (observations.first as Map<String, dynamic>)['status'] != value['status']) {
      throw const FormatException('Inconsistent local runner result');
    }
    final integrity = value['integrity'];
    if (integrity is! Map<String, dynamic> ||
        integrity['algorithm'] != 'sha256' ||
        integrity['assertion'] != 'checksum-only-not-signed' ||
        integrity['digest'] is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(integrity['digest'] as String)) {
      throw const FormatException('Missing report integrity metadata');
    }
    return RunReportSnapshot(Map<String, dynamic>.unmodifiable(value));
  }
  String get id => data['id'] as String;
  String get status => data['status'] as String;
  String get revisionLabel {
    final revision = data['sourceRevision'];
    if (revision is Map<String, dynamic> && revision['status'] == 'UNKNOWN') {
      return 'Unknown (mutable workspace)';
    }
    return 'Not established by this local runner';
  }
}

String comparisonPath(String before, String after) {
  final a = before.trim(), b = after.trim();
  reportPath(a);
  reportPath(b);
  if (a == b) throw const FormatException('Choose two different report IDs');
  return '/runs/compare/$a/$b';
}

class ReportComparison {
  const ReportComparison(this.project, this.status, this.beforeStatus, this.afterStatus);
  final String project, status, beforeStatus, afterStatus;

  factory ReportComparison.parse(Object? value, {required String beforeId, required String afterId}) {
    comparisonPath(beforeId, afterId);
    if (value is! Map<String, dynamic> || value['schemaVersion'] != 1 ||
        value['profile'] != 'node-built-in-tests' || value['project'] is! String ||
        value['productionReady'] != false || value['productCertified'] != false ||
        value['revisionComparison'] != 'NOT_ESTABLISHED' || value['environmentEquivalenceVerified'] != false ||
        !['OBSERVATIONS_MATCH', 'OBSERVATIONS_DIFFER', 'CONTEXT_DIFFERS'].contains(value['status'])) {
      throw const FormatException('Invalid report comparison');
    }
    Map<String, dynamic> outcome(Object? item, String id) {
      if (item is! Map<String, dynamic> || item['id'] != id ||
          !['PASSED', 'FAILED', 'TIMEOUT', 'INFRASTRUCTURE_ERROR', 'NOT_EXECUTED'].contains(item['status']) ||
          (item['exitCode'] != null && item['exitCode'] is! int) ||
          item['integrityDigest'] is! String || !RegExp(r'^[a-f0-9]{64}$').hasMatch(item['integrityDigest'] as String)) {
        throw const FormatException('Invalid comparison outcome');
      }
      return item;
    }
    final a = outcome(value['before'], beforeId), b = outcome(value['after'], afterId);
    final matches = a['status'] == b['status'] && a['exitCode'] == b['exitCode'];
    if (value['status'] != 'CONTEXT_DIFFERS' && (value['status'] == 'OBSERVATIONS_MATCH') != matches) {
      throw const FormatException('Inconsistent comparison outcome');
    }
    return ReportComparison(value['project'] as String, value['status'] as String, a['status'] as String, b['status'] as String);
  }
}

class TestLabHome extends StatefulWidget {
  const TestLabHome({super.key});
  @override
  State<TestLabHome> createState() => _TestLabHomeState();
}

class _TestLabHomeState extends State<TestLabHome> {
  final endpoint = TextEditingController(text: 'http://127.0.0.1:8787');
  final token = TextEditingController();
  final project = TextEditingController(text: 'node-sample');
  final reportId = TextEditingController();
  final beforeId = TextEditingController();
  final afterId = TextEditingController();
  final client = http.Client();
  bool running = false;
  String result = 'No test runs yet';
  RunReportSnapshot? runReport;
  String filter = 'all';
  FarmSnapshot? farm;
  DateTime? observedAt;
  String? farmError;
  CapabilitySnapshot? capabilities;
  String? capabilityError;
  ReportComparison? comparison;
  String? comparisonError;

  Future<Object?> request(String path, {Map<String, String>? body}) async {
    final uri = apiUri(endpoint.text, path);
    final req = http.Request(body == null ? 'GET' : 'POST', uri)
      ..followRedirects = false
      ..headers['Authorization'] = 'Bearer ${token.text.trim()}';
    if (body != null) {
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    final response = await client.send(req).then(http.Response.fromStream)
        .timeout(Duration(seconds: body == null ? 30 : 180));
    if (response.statusCode != 200) {
      throw StateError('API request rejected');
    }
    return jsonDecode(response.body);
  }

  Future<void> runTests() async {
    if (running) return;
    setState(() { running = true; runReport = null; result = 'Executing tests...'; });
    try {
      final data = await request('/runs', body: {'project': project.text.trim()});
      final snapshot = RunReportSnapshot.parse(data);
      if (mounted) setState(() {
        runReport = snapshot;
        reportId.text = snapshot.id;
        result = const JsonEncoder.withIndent('  ').convert(snapshot.data);
      });
    } catch (_) {
      if (mounted) setState(() => result = 'Test request failed.');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }

  Future<void> retrieveReport() async {
    if (running) return;
    final requestedId = reportId.text.trim();
    setState(() { running = true; runReport = null; result = 'Retrieving saved report...'; });
    try {
      final snapshot = RunReportSnapshot.parse(
          await request(reportPath(requestedId)), expectedId: requestedId);
      if (mounted) setState(() {
        runReport = snapshot;
        result = const JsonEncoder.withIndent('  ').convert(snapshot.data);
      });
    } catch (_) {
      if (mounted) setState(() => result = 'Saved report unavailable or invalid.');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }

  Future<void> inspectFarm() async {
    if (running) return;
    setState(() { running = true; farm = null; observedAt = null; farmError = null; });
    try {
      final snapshot = FarmSnapshot.parse(await request('/device-farm'));
      if (mounted) setState(() { farm = snapshot; observedAt = DateTime.now(); });
    } catch (_) {
      if (mounted) setState(() => farmError = 'Inventory unavailable or unauthorized.');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }

  Future<void> compareReports() async {
    if (running) return;
    final before = beforeId.text.trim(), after = afterId.text.trim();
    setState(() { running = true; comparison = null; comparisonError = null; });
    try {
      final result = ReportComparison.parse(await request(comparisonPath(before, after)), beforeId: before, afterId: after);
      if (mounted) setState(() => comparison = result);
    } catch (_) {
      if (mounted) setState(() => comparisonError = 'Comparison unavailable or incompatible.');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }

  Future<void> inspectCapabilities() async {
    if (running) return;
    setState(() { running = true; capabilities = null; capabilityError = null; });
    try {
      final snapshot = CapabilitySnapshot.parse(await request('/capabilities'));
      if (mounted) setState(() => capabilities = snapshot);
    } catch (_) {
      if (mounted) setState(() => capabilityError = 'Capability catalog unavailable.');
    } finally {
      if (mounted) setState(() => running = false);
    }
  }

  @override
  void dispose() {
    client.close(); endpoint.dispose(); token.dispose(); project.dispose(); reportId.dispose(); beforeId.dispose(); afterId.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = farm;
    final visible = snapshot?.devices.where((d) =>
        filter == 'all' || d['platform'] == filter) ?? const <Map<String, dynamic>>[];
    return Scaffold(
      appBar: AppBar(title: const Text('TrillionAI TestLab')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        TextField(controller: endpoint, enabled: !running, decoration: const InputDecoration(labelText: 'Backend URL')),
        TextField(controller: token, enabled: !running, obscureText: true, decoration: const InputDecoration(labelText: 'API token')),
        const SizedBox(height: 20),
        Text('Phone farm', style: Theme.of(context).textTheme.headlineSmall),
        OutlinedButton.icon(onPressed: running ? null : inspectFarm, icon: const Icon(Icons.refresh), label: const Text('Refresh inventory')),
        if (running) const LinearProgressIndicator(),
        if (farmError != null) Text(farmError!),
        if (snapshot != null) ...[
          Text('Inventory status: ${snapshot.status}'),
          Text('Observed locally: ${observedAt!.toIso8601String()}'),
          Wrap(spacing: 8, children: [
            Chip(label: Text('Devices: ${snapshot.devices.length}')),
            Chip(label: Text('Available: ${snapshot.available}')),
            Chip(label: Text('Quarantined: ${snapshot.quarantined}')),
          ]),
          DropdownButton<String>(value: filter, items: const [
            DropdownMenuItem(value: 'all', child: Text('All platforms')),
            DropdownMenuItem(value: 'android', child: Text('Android')),
            DropdownMenuItem(value: 'ios', child: Text('iOS')),
          ], onChanged: (v) { if (v != null) setState(() => filter = v); }),
          if (visible.isEmpty) const Text('No matching devices observed.'),
          for (final device in visible)
            Card(child: ListTile(
              leading: Icon(device['available'] == true ? Icons.check_circle_outline : Icons.block),
              title: Text(device['id'] as String),
              subtitle: Text("${device['platform'] ?? 'Unknown'} · Host: ${device['host'] ?? 'local'}\nState: ${device['leaseState'] ?? device['state'] ?? 'UNKNOWN'}\nHardware: ${device['hardwareKind'] ?? 'unverified'}"),
            )),
        ],
        const Divider(height: 32),
        Text('Testing capabilities', style: Theme.of(context).textTheme.headlineSmall),
        OutlinedButton.icon(onPressed: running ? null : inspectCapabilities, icon: const Icon(Icons.refresh), label: const Text('Refresh capabilities')),
        const Text('Declared local runner capabilities only; no customer tests have been executed by this view.'),
        if (capabilityError != null) Text(capabilityError!),
        if (capabilities != null) ...[
          Text('Partial coverage domains: ${capabilities!.partial} / ${capabilities!.domains.length}'),
          for (final domain in capabilities!.domains)
            ListTile(title: Text(domain['label'] as String), subtitle: Text('${domain['implementationStatus']} · NOT_EXECUTED')),
        ],
        const Divider(height: 32),
        TextField(controller: project, enabled: !running, decoration: const InputDecoration(labelText: 'Workspace project directory')),
        FilledButton.icon(onPressed: running ? null : runTests, icon: const Icon(Icons.science), label: const Text('Run Node.js test suite')),
        const Divider(height: 32),
        Text('Saved test report', style: Theme.of(context).textTheme.headlineSmall),
        TextField(controller: reportId, enabled: !running, decoration: const InputDecoration(labelText: 'Report ID')),
        OutlinedButton.icon(onPressed: running ? null : retrieveReport, icon: const Icon(Icons.receipt_long), label: const Text('Retrieve saved report')),
        if (runReport != null) ...[
          Text('Observed result: ${runReport!.status}'),
          Text('Source revision: ${runReport!.revisionLabel}'),
          const Text('Checksum metadata is not a signature or product certification.'),
        ],
        SelectableText(result),
        const Divider(height: 32),
        Text('Compare saved runs', style: Theme.of(context).textTheme.headlineSmall),
        TextField(controller: beforeId, enabled: !running, decoration: const InputDecoration(labelText: 'Earlier report ID')),
        TextField(controller: afterId, enabled: !running, decoration: const InputDecoration(labelText: 'Later report ID')),
        OutlinedButton.icon(onPressed: running ? null : compareReports, icon: const Icon(Icons.compare_arrows), label: const Text('Compare reports')),
        if (comparisonError != null) Text(comparisonError!),
        if (comparison != null) ...[
          Text('Project: ${comparison!.project}'),
          Text('Comparison: ${comparison!.status}'),
          Text('Earlier result: ${comparison!.beforeStatus}'),
          Text('Later result: ${comparison!.afterStatus}'),
          const Text('Source revision and environment equivalence are not established. A changed outcome does not prove a repair.'),
        ],
        const SizedBox(height: 24),
        const Text('Inventory is observational. This dashboard does not certify readiness or deploy applications.'),
      ]),
    );
  }
}
