"""Cross-platform fixes for the pinned GenLayer direct-test RC.

genlayer-test 0.30.0rc2 closes the temporary descriptor backing fd 0 on
Windows before the contract SDK lazily reads its message.  A pipe keeps the
encoded message alive until that read while preserving the RC's exact wire
format.  Remove this shim when the pinned RC contains the upstream fix.
"""

import os
import sys


def pytest_configure() -> None:
    from gltest.direct import loader
    from gltest.direct import sdk_compat
    from gltest.direct import vm as vm_module
    from gltest.direct import wasi_mock

    # The pinned runner exposes calldata/types below genlayer.py while the
    # testing RC probes a newer top-level export first.
    def import_calldata():
        import genlayer.py.calldata as calldata

        return calldata

    def import_address():
        from genlayer.py.types import Address

        return Address

    loader.import_calldata = import_calldata
    loader.import_address = import_address
    sdk_compat.import_calldata = import_calldata
    sdk_compat.import_address = import_address

    def import_types():
        import genlayer.py.types as types

        return types

    def import_address_u256():
        types = import_types()
        return types.Address, types.u256

    sdk_compat.import_types = import_types
    sdk_compat.import_address_u256 = import_address_u256
    vm_module.import_address_u256 = import_address_u256
    wasi_mock.import_calldata = import_calldata

    def inject_message_to_fd0(vm) -> None:
        calldata = import_calldata()
        Address = import_address()

        def address(value):
            return Address(value) if isinstance(value, bytes) else value

        encoded = calldata.encode(
            {
                "contract_address": address(vm._contract_address),
                "sender_address": address(vm.sender),
                "origin_address": address(vm.origin),
                "stack": [],
                "value": vm._value,
                "datetime": vm._datetime,
                "is_init": False,
                "chain_id": vm._chain_id,
                "entry_kind": 0,
                "entry_data": b"",
                "entry_stage_data": None,
            }
        )
        read_fd, write_fd = os.pipe()
        try:
            os.write(write_fd, encoded)
        finally:
            os.close(write_fd)
        vm._original_stdin_fd = os.dup(0)
        os.dup2(read_fd, 0)
        os.close(read_fd)

    loader._inject_message_to_fd0 = inject_message_to_fd0

    def allocate_contract(contract_cls, vm, *args, **kwargs):
        from genlayer.py.storage import ROOT_SLOT_ID
        from genlayer.py.storage._internal.generate import (
            ORIGINAL_INIT_ATTR,
            Lit,
            _storage_build,
        )

        descriptor = _storage_build(contract_cls, {})
        assert not isinstance(descriptor, Lit)
        instance = descriptor.get(vm._storage.get_store_slot(ROOT_SLOT_ID), 0)
        init = getattr(getattr(descriptor, "cls", contract_cls), "__init__", None)
        if init is not None:
            init = getattr(init, ORIGINAL_INIT_ATTR, init)
            init(instance, *args, **kwargs)
        return instance

    loader._allocate_contract = allocate_contract

    def patch_nondet_for_direct_mode() -> None:
        import genlayer.gl.vm as gl_vm
        from genlayer.py.types import Lazy
        from gltest.direct import wasi_mock

        # gltest's validator helper imports this newer alias.
        sys.modules["genlayer.vm"] = gl_vm
        if getattr(gl_vm, "_genetia_direct_patched", False):
            return

        def run(leader_fn, validator_fn, /, **_kwargs):
            vm = wasi_mock.get_vm()
            vm._in_nondet = True
            try:
                result = leader_fn()
            finally:
                vm._in_nondet = False
            vm._captured_validators.append((result, leader_fn, validator_fn))
            return result

        run.lazy = lambda leader_fn, validator_fn, **kwargs: Lazy(
            lambda: run(leader_fn, validator_fn, **kwargs)
        )
        gl_vm.run_nondet = run
        gl_vm.run_nondet_default = run
        gl_vm.run_nondet_unsafe = run
        gl_vm._genetia_direct_patched = True

    loader._patch_run_nondet_for_direct_mode = patch_nondet_for_direct_mode
