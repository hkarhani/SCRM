import asyncio
import importlib
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch


class HostCsvImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix="scrm-csv-test-")
        cls.environment = patch.dict(os.environ, {"SCRM_DATA_DIR": cls.workspace.name})
        cls.environment.start()
        cls.server = importlib.import_module("app.server")

    @classmethod
    def tearDownClass(cls):
        cls.environment.stop()
        cls.workspace.cleanup()

    def test_empty_or_invalid_ipv4_column_never_imports_other_columns(self):
        for header in ("IPv4 Address", " ipv4 address ", "IPv4 Addr"):
            for value in ("", "invalid", "2001:db8::1", "999.1.2.3"):
                with self.subTest(header=header, value=value):
                    content = f"{header},Gateway\n{value},198.51.100.7\n".encode()
                    with self.assertRaises(self.server.HTTPException) as caught:
                        self.server.parse_host_ip_file(content)
                    self.assertEqual(caught.exception.status_code, 400)

    def test_valid_rows_are_deduplicated_and_other_ip_columns_are_ignored(self):
        rows = self.server.parse_host_ip_file(
            b"IPv4 Address,Gateway\n192.0.2.10,198.51.100.1\n"
            b"192.0.2.10,198.51.100.2\ninvalid,198.51.100.3\n"
            b"192.0.2.20,198.51.100.4\n"
        )
        self.assertEqual([row["ip"] for row in rows], ["192.0.2.10", "192.0.2.20"])

    def test_bom_quoted_fields_and_crlf(self):
        rows = self.server.parse_host_ip_file(
            '\ufeff"IPv4 Address",Name\r\n"192.0.2.30","host, name"\r\n'.encode()
        )
        self.assertEqual([row["ip"] for row in rows], ["192.0.2.30"])

    def test_existing_json_generic_csv_and_text_imports_still_work(self):
        for content in (
            b'{"hosts": [{"ip": "192.0.2.40"}]}',
            b"ip,name\n192.0.2.40,test\n",
            b"Host address: 192.0.2.40\n",
        ):
            with self.subTest(content=content):
                rows = self.server.parse_host_ip_file(content)
                self.assertEqual([row["ip"] for row in rows], ["192.0.2.40"])

    def test_rejected_upload_preserves_previous_host_snapshot(self):
        previous = json.dumps({"count": 1, "hosts": [{"ip": "192.0.2.50"}]})
        self.server.HOSTS_PATH.write_text(previous, encoding="utf-8")
        upload = self.server.UploadFile(
            filename="hosts.CSV",
            file=io.BytesIO(b"IPv4 Address,Gateway\n,198.51.100.8\n"),
        )
        with self.assertRaises(self.server.HTTPException) as caught:
            asyncio.run(self.server.upload_artifact("hosts", upload))
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self.server.HOSTS_PATH.read_text(encoding="utf-8"), previous)

    def test_successful_upload_updates_analysis_host_count(self):
        upload = self.server.UploadFile(
            filename="hosts.CSV",
            file=io.BytesIO(b"IPv4 Address\n192.0.2.60\n192.0.2.60\n192.0.2.61\n"),
        )
        result = asyncio.run(self.server.upload_artifact("hosts", upload))
        self.assertEqual(result["summary"]["hosts"], 2)
        self.assertEqual(self.server.build_analysis()["summary"]["host_ips"], 2)


if __name__ == "__main__":
    unittest.main()
