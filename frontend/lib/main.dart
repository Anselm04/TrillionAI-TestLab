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

class TestLabHome extends StatefulWidget {
  const TestLabHome({super.key});
  @override
  State<TestLabHome> createState() => _TestLabHomeState();
}

class _TestLabHomeState extends State<TestLabHome> {
  final endpoint = TextEditingController(text: 'http://127.0.0.1:8787');
  final token = TextEditingController();
  final project = TextEditingController(text: 'node-sample');
  final client = http.Client();
  bool running = false;
  String result = 'No test runs yet';
  String filter = 'all';
  FarmSnapshot? farm;
  DateTime? observedAt;
  String? farmError;
  CapabilitySnapshot? capabilities;
  String? capabilityError;

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
    setState(() { running = true; result = 'Executing tests...'; });
    try {
      final data = await request('/runs', body: {'project': project.text.trim()});
      if (mounted) setState(() => result = const JsonEncoder.withIndent('  ').convert(data));
    } catch (_) {
      if (mounted) setState(() => result = 'Test request failed.');
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
    client.close(); endpoint.dispose(); token.dispose(); project.dispose();
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
        SelectableText(result),
        const SizedBox(height: 24),
        const Text('Inventory is observational. This dashboard does not certify readiness or deploy applications.'),
      ]),
    );
  }
}
