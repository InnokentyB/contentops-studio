# Runtime-policy transition proposal: Owner manual publication confirmation

Status: **PROPOSAL ONLY — RELEASE BLOCKED; owner approval required.** No scanner, policy baseline or transition exception is changed by this document.

## LOCK: precise goal and boundary

Permit an independently reviewed, exact identity transition for existing runtime-policy debt whose enclosing statements changed when the approved manual-publication preservation fences were added. Preserve all fences, tenant checks, denial routes, attempt/fact/history custody and existing debt ownership. This proposal does not authorize new task-specific production authority, provider calls, production activation, publication, baseline growth or a general exemption.

The frozen comparison uses released base `5b5bb0324d8f6b7003c0ca1fa2ca2e681c451c4b`. The current gate reports 102 NEW_RUNTIME_POLICY_DEBT and 102 STALE_BASELINE_ENTRY across 16 source files; findings and baseline both remain 6,823. This is still a failing gate under the current policy. Equal counts alone do not authorize it.

## QAR: measurable admission conditions

Exactly 102 bijective identity pairs, 16 exact old/new source hashes and 110 occurrences are eligible. Rule totals are task_identifier 73 pairs/81 occurrences; business_binding 20/20; business_record_lookup 8/8; business_comparison 1/1. Every pair must preserve file, rule, exact printed leaf syntax, occurrence count and baseline reason/owner/remediation. No unrelated baseline row may change. Total findings/baseline stay 6,823, without newly introduced debt.

The existing 65,536-byte production artifact limit remains unchanged. The linked 67,044-byte proof JSON is diagnostic review evidence, not an admissible production transition artifact. A compact manifest must omit repeated audit text while retaining every binding; if it exceeds the existing cap, fail rather than raising the cap. Preserve existing regular-file/symlink checks, source byte budgets, read/time limits, collision checks and fail-closed behavior.

Required negative tests: new literal; changed leaf; changed rule/file/scope; count growth; source SHA drift; changed ownership/remediation; duplicate/colliding/missing pair; oversized manifest; malformed artifact; current-branch-only self-authorization; altered trusted base. Each must fail. A positive fixture permits only this exact approved bijection, followed by a clean gate and the existing publication-preservation acceptance tests.

## ARCH: strict two-stage trusted-base option

1. **Stage A, separately reviewed policy-only change.** After explicit owner approval, implement a narrowly bounded validator and compact manifest for this exact set. Current policy supports at most eight files, only task_identifier and named-function header transitions; it cannot express these 16 files and four rules. Any extension must admit exactly the reviewed records and same-leaf proof, rather than trusting an entire file or statement class. Bind all 16 old/new source SHA256 values and all 102 pairs below. Keep source/baseline unchanged in this stage. Test the validator and its hostile inputs. Merge this separate change into the trusted base before the feature can consume it.
2. **Stage B, feature integration.** Rebase the frozen feature onto that merged trusted base. Read transition authority only from that trusted commit, never the feature branch's newly supplied artifact. Replace exactly the 102 old baseline identities with their corresponding new identities, preserving counts, reason, owner and remediation. Require source hashes and scanner output to match the approved manifest. Re-run quality gate, relevant build and acceptance/regression tests. Any drift requires a new reviewed scope; a successful engineering run still does not constitute owner UAT.

The current branch cannot authorize itself. No baseline or validator change is authorized merely by writing this proposal. The transition may be retired once the resulting baseline is itself trusted, preserving immutable review evidence. No arbitrary future file, literal or callback qualifies through this record.

## RISK: security and preservation review

The existing scanner includes enclosing statement context in identities. Adding a lock/fact fence or transaction wrapper therefore changes a fingerprint even when its policy-relevant leaf stays identical. The proof pairs old/new findings by file, rule, exact printed leaf and count, disambiguating identical repeated leaves in source order. It proves syntax/count preservation, not semantic equivalence: independent source-diff review must establish that the guards introduce no new execution authority and retain all historical controls. A pre-existing task-bound expression remains debt, not newly approved reusable design.

Do not remove preservation guards, weaken tests, add proxy indirection, rename functions solely to hide debt, accept all hashes in a file, or silence the scanner. Unknown revision remains unknown; manual confirmation must never manufacture acceptance of an unaccepted edit. This proposal provides no send/retry/adoption authority.

Alternative: retire the affected legacy task-bound runtime authority through shared data-driven lifecycle contracts, retaining audit/history/UNKNOWN behavior. That is materially larger product and architecture work requiring a separate LOCK/QAR/ARCH/RISK and scenario plan; it is not an incidental cleanup authorized by this local feature.

## Frozen evidence

Scanner SHA256: `60e5e6c627c9b1a519f2fe890a0d3226611d3a143149c167155f26cf5436be47`.

Baseline SHA256: `bf09a6ba7613b94790a779d6007b4374d16e9edaf419b6cb589cd57473b02ef4`.

Proof artifact SHA256: `387c1264ffe1ce778eadd5109a459fab7fc8a19be6f903a484dfd8b25f45401d`. Full leaves, line references and anchor kinds are in [runtime-policy-transition-pairs.json](runtime-policy-transition-pairs.json). The scanner and baseline were not modified to generate this evidence.

| # | Source | Old SHA256 | New SHA256 | Pairs |
|---|---|---|---|---|
| 1 | `src/services/agent_workspace_manifest.service.ts` | `ae38070a752c842a7bcd76b8a046d83b3ec224921e98f804a199326c66209a06` | `1296fbd53a9c0ac11ce2bc71a2186317754bc8c31505dd41b461c4cc8e8d6861` | 1 |
| 2 | `src/services/dzen1002_runtime_store.ts` | `a511e54b397e00eb13922f6a8c7b6c791781f423c1de90b2a8a36fef834d9fcf` | `ec4f8781f162ae904ed511534678fc46530a67e915bd28f5ae2d603040673c26` | 5 |
| 3 | `src/services/dzen_task1045_draft_resume.service.ts` | `d0ef0474bab65d7ca3f91c1ff06462502e7ddd16c42b1df48b71d7150cac2725` | `55bcbd36aa590403ff2a7ec444d7c4bedc6fa4130d55b8839400a7ca00ec0d5f` | 9 |
| 4 | `src/services/dzen_task1045_new_draft_recovery.service.ts` | `aae93a42dcd93afed41dffd6c3cfe3819550ee7e95bca33c341d8621bc04bae4` | `3a9e6f2964e58132b628260f2f60484d45103642565247d21031827d37b2d14b` | 2 |
| 5 | `src/services/dzen_task1045_phase_a.service.ts` | `ee867976936847f1ea1ec2958bfa1a4a236e59861354edfd404894894fb8669c` | `97dac5ce8aad0dff13055df08b3c62f74194eab2d460f5b6040532dc46cab027` | 6 |
| 6 | `src/services/dzen_task1045_phase_a_v2.service.ts` | `39f801722f7b7c2dbbff6da84f00e476cbc9ea6b89f2ed614664ff1bd84b24dd` | `1b09fddc1a810b7f05fe4c35986ddc8c706615182b79e3fa56896121908bed4c` | 6 |
| 7 | `src/services/dzen_task1045_phase_a_v2_reconcile.service.ts` | `f78e8ff7f4e99387d422b31a14ccd20c63853557d4998b14fa7441183a37b677` | `e190b7bc2775293518ab33cf018a734e9458003154878245ee29c1856d198534` | 6 |
| 8 | `src/services/dzen_task1045_phase_b.service.ts` | `036c16570c3b1272c0ed22bac4ba2f1726a049cf32e010aa6cd18ccdb3639c34` | `1eea9762a9bd320241a94a161adc0c4d366358c0ba17f44827f9bf522914a094` | 6 |
| 9 | `src/services/dzen_task1045_phase_b_reconcile.service.ts` | `f37010d3fc4912063835ec77ccdce5b2ca1845a54adea887b5b740e674939421` | `77c9edd2b6eee6f00293087746f7691b1335c1322a5e8ac681149381d079023b` | 6 |
| 10 | `src/services/dzen_task1045_phase_c.service.ts` | `15747824c9d324318e6c28cf296f2528184f1e99631b5c69abc747578fc438a1` | `ea62e9a758b48f1e4ee6817a2bca9a995e1e70a6b5fff54986f0395bd546575a` | 6 |
| 11 | `src/services/dzen_task1045_phase_c_reconcile.service.ts` | `122e5ff61c82459d79a2a1605cafb7e584bf7a12b38a685c2c91fc5c8681aec8` | `0b96c6063a9ef9bf272abd24fc83e69912942e1bf7e237510e92396d6e373966` | 6 |
| 12 | `src/services/dzen_task1045_restore_reconcile.service.ts` | `188be06693352306369334f529fbc3c6a0150f4eab6db2e36130b5c2eee4aece` | `8ef5a43ca5d2d822ebf92a6352992975cfe948dd8436e57568e63687da97ded1` | 4 |
| 13 | `src/services/dzen_task1045_second_attempt_recovery.service.ts` | `273ff8cf5903936200092c29e88c17a2259377ca6d65103ded8a54d4eec99450` | `0b852246fb65421e49c51d6a15c3436861a3caccc2223394424da29e0b12cb9a` | 15 |
| 14 | `src/services/dzen_task1045_zero_restore.service.ts` | `986ae7239f78e6a03606858678fcd60a5acc092d2ebbf147288250424b193ae5` | `ff9917a1776b0752e9a01b53ba7ad744dda68862c3bfe8621a8c71034cee6e8d` | 9 |
| 15 | `src/services/dzen_task999_resume.service.ts` | `f153f55d4b5bc89985a8798eafe2971be00f149358f2738bc41dc8ae0a220048` | `67e4a88e25b9e59b090a502cf30dec8225d5f124a5e528625c0fc82f452434c9` | 8 |
| 16 | `src/services/dzen_task_publication.service.ts` | `d9ea01531f12bcab8466a5156fde88d7dc9469490677ce3c5ed017f6bce7822f` | `85b2bf88d3be577d0daf4b419fc5aa83ec4a524616a30a9dfe3deeed869a226e` | 7 |

## Exact identity transition records

File numbers refer to the frozen source table. Counts are occurrence counts; identities are full SHA256 strings. The linked proof binds each pair to its identical leaf and leaf SHA256.

| File | Rule | Old identity | New identity | Count |
|---|---|---|---|---|
| 1 | `business_record_lookup` | `d3a76e85d31782bd53044201da5ad7c6cbecb2c3cad76d7ef02a699583cf8c51` | `88058ed0e6b9630934cd66c00aeac0e7f02b6db5e01c3b740400bd5b48c32e77` | 1 |
| 2 | `task_identifier` | `1498ba26825e5770e6030249712dd2812247d1bf94e58fe90fda869aba2dfc50` | `a19ddf37ecd97c927ccb0d5cb90cdee084bbac4944395727d1f171327cce3d16` | 1 |
| 2 | `task_identifier` | `b9140a1460bc124687db5cf85a2b0cf4951ad7c69870ef4d31ac23b1e1cae15f` | `c485c5f765082de03a53e8eadf43c0e651c251b06b432ec7364dafa869f88e43` | 1 |
| 2 | `task_identifier` | `1eda07a5e7255173f9a40a287adec191035c25ba6106537d29c95c7458c49b35` | `67de60d978240d1589d682631d831f195a6659733ae5d28956996dc7a42c70ed` | 1 |
| 2 | `task_identifier` | `d8c8622a7460991420f5a59bfaa13ed58eb851d1166936a6c77406186cb28779` | `d37c46fd3a645754376701f9789a4ef8377585af1d1edae64b56d1b48358a517` | 1 |
| 2 | `task_identifier` | `be9735b0f08a2ffaca9fb6c882ade9060854d151302a52743a28aa86d5e2d004` | `e50a2ab5b31bf1e264abe01b28e7ddccf0cd60cab83085a76759768bcdf5a710` | 3 |
| 3 | `task_identifier` | `ff0fd62177b2b912767065ccb5cf51adff5c21de9deadd03cc3be5240240a8f3` | `cb5b5ab7d4dc258bf92ae3521b46d0a918f3d444910acb5788d5e4d854e1446d` | 1 |
| 3 | `task_identifier` | `9b2ed036366568f2160644137c3107643dce40395a31ba85789f19757c833f78` | `f2336499910500b785e7bdc422f14af51226dd2d7a3def50c26982179617fd4d` | 1 |
| 3 | `task_identifier` | `0e96a030f42789c776c7f298a497c4bca5837151d88297cb9ee7b69d3e42fd1c` | `c627038c3d17490cf89e40c761b217c9dc72368b3d186a3316469e6515f4d72f` | 1 |
| 3 | `business_binding` | `7f5ccb54e9718bb50c322124a3b0db8774bea7c805349d86f7bbd0b6713bf680` | `faf83268877266c20be3aedc496fd10799c4fb95392167b8a2ea53edb1ec26f4` | 1 |
| 3 | `business_binding` | `ffde56def97e52b63dd3ccbdb723aab8d820105c56495393c88e97c9cf0f55f6` | `8f5a83174faaca02a8b724a2d1009d4b0dfb4cecbf6f08f2957969043447b594` | 1 |
| 3 | `business_binding` | `98e49b93b5fcf3d7d69b996b3aee00657135cfeaf3444e6823e939fd5703b224` | `e64b2eec493584f4648c2d3e2d098d7e52ad6d7cb2456109742b6cfa7137003a` | 1 |
| 3 | `business_binding` | `44fbc2067d7c678e0b3228012dc2ecfa8ccf382b2090077cbd4c29631e8089bb` | `18aa8ef4361ac03b697bea0c50cba9601992e52feea22625760abb0ecc6c05a7` | 1 |
| 3 | `task_identifier` | `bbd45b91f71d535ddfc1eefb134a8d615b639d40f78797d613cb15e6e8528fa1` | `87450861d3049d008109fb25884bf64a9b23adb03c50f4a8389ebd9bacf0cc7f` | 1 |
| 3 | `task_identifier` | `fcf2f6ed52a866e37968db3d7bca50a7339d5be40fcc634eff5aad5580f684f3` | `376e1313574bf78b5e68529febb626c2c4177365abd05771e7e25ddef955b432` | 1 |
| 4 | `task_identifier` | `5c0b44207eefebd890c4e5f4a6b81863c37678e616b24c949f33fbd13b2abf44` | `16dd6068f047b416d24241ca53a897f5f3be15be3df1c2443dbb7bec8371173e` | 1 |
| 4 | `task_identifier` | `dae63283951cdd1acb0ee3dd49234caefb40892c2d8a9d898e232779be203735` | `4b639aa3544d100d914149893a08144c54ccf73273e82d0c1d11aa823227047b` | 1 |
| 5 | `task_identifier` | `d24a048b70bb9e8435087e5af6ec228cc1c6dc819579ecea3453f540f4edf83d` | `d95a1bd1f2d23a3d82c9eb08be13c40833d4ccc7e5bd8a43ccdc69b25db69efc` | 1 |
| 5 | `task_identifier` | `e876f42e726e57e3f71814512077778b179712814edfdffaf9482efc5fdb86d4` | `d65a3f2ffb9d4f74a64aa02f939cbdb86bcf0aa28dab9cad22a95abbc5e75f2c` | 1 |
| 5 | `task_identifier` | `bdf1cbf4c35831ea032ac33d94a398f7b6ac3b835aed2fc3d04a4f6f39a82538` | `4befa88cb0e80face7e7a652f90cb4aa936e65a40b0ffb1693765104952e63a0` | 1 |
| 5 | `task_identifier` | `611520b6ddcb6677b57194f893cd2dc20a7c78da05f7c571bf0e527a99880f9f` | `0851236a31aa2aa79db5c0101fccaab61178992060cc9e5567ac936127b8f8a4` | 1 |
| 5 | `task_identifier` | `199d952fa26e2235c33d79d2763674b0d3deed0096348ab9ebd2a0c771dc7220` | `2727cb5b83d80bda1c15b755ef660c1c7856685d5e0902767d18789915d23d6d` | 1 |
| 5 | `business_record_lookup` | `8e2f2cb28e56c22b0f205eccbe8ed4f8feb93f3ef8a328bfd5e978ec59f1f771` | `bef9dc6bfe3f92380a729439cec86a3b9b709b77f261c03c4524dd75191b0e6b` | 1 |
| 6 | `task_identifier` | `0b589963f7d9b2b4eebfe9de26fdc5c24b29b770da136cd9e7793401982a9404` | `27141dd072c4be9b6a2939173716eeb9281f2ae2aad27639b20a6c07575adce3` | 1 |
| 6 | `task_identifier` | `a3b1b99b9f6a7e5635709421fefbf85f6d4818986dec2f04e96b0e51641920f4` | `d69b37d658b8883e5074251947ac48c6972d4ae7b14c53c11f46ae0b6bd641eb` | 1 |
| 6 | `task_identifier` | `f7bb582c0d467eb1cde1d07303abeaa37145238600a2e5c93fa66adf4673d6eb` | `f56d4bfb9f2e1ffe7bff30a46445781a16a200c3ceef0cd4a75a0247731c9c12` | 1 |
| 6 | `task_identifier` | `6d6ba3003b5e3c1937ed53db37c1e714c3faec9f633bff1daaeb41b47e98b9d2` | `7ffdd63b140a2a5873aa3199c2f5e4a0bd4c4f4f200947c9619f78eaadd9a9d5` | 1 |
| 6 | `task_identifier` | `a5adad97e0d10e3adb72518c1c5354ebe9c5cf03b66df97bb66c2b249ce2d60c` | `6543053345ebcb33e8baf80127e68e98368e02af564978e6a5a9b3ec9163814b` | 1 |
| 6 | `business_record_lookup` | `6ec8403e80abe99169af183a7f3238455e7d48ba4943020562ef6853cc474db9` | `e20aa504fd9eedd8483d8b0e9dc4018a5bd50c6bcf2070d96932528527bc75f7` | 1 |
| 7 | `task_identifier` | `360d64f73c7e63e92c8bd08ffb75351f72a2e4891a306fe4f8fbc0abee86859a` | `8f54e490039082fe720b16725a0846f65fa476079bf44927a07a91692c1f7ae3` | 1 |
| 7 | `task_identifier` | `5c384a27fcd109a3851c0f54c62b7b3a0205d8b5ce4d2900d02d0c5824b4c6a8` | `425918c601adc59aa9802171010dd4ce95330912b3cc74fa09ce1467cbd12d14` | 1 |
| 7 | `task_identifier` | `f10b330bef705386989efdef62ee0b8fac1171e9f05e6a83f5a5c1062ea92e1e` | `7d620e1d42ac4dfbd55c59825a294e87f40c45277ebeeb09d58044d97b161fbe` | 1 |
| 7 | `task_identifier` | `f299c283a424317c08c342d5fad1b852eace9a35b05f1854243520ceb951fc53` | `a0f7a2673b3d8e454f5baf002d3ce9d786f27beee82ddddee8cf2355c3c6c9d4` | 1 |
| 7 | `task_identifier` | `ba80c2b4a81bb35b1e7bf077fea76ca8599469286a2a3fae98c4c3120e358aac` | `21e74bcc7a1861a06bf99cddbcda66ab3357647c106ff058f3357fca3a259f8b` | 1 |
| 7 | `task_identifier` | `55a120b265aa889e7d478a1a4922e9e1840e98cedad88f520ba1212ce0faaa7c` | `4a648b2949108ca6d5a75c4b4d35314eaf8c3d638c29e4f1df9f1bebb1098afe` | 1 |
| 8 | `task_identifier` | `3fcc41b2963b1a408f7c36f2b1f9e47fc6696590e89cf85f43096b01c380190e` | `90dd9f74239f943d2ad2e84bf0f6afed28146cf52666fdd487d61f7dd064c283` | 1 |
| 8 | `task_identifier` | `bc89d2c2106debb7f5ce3d567151dc9f1c0b39a45b7b000d2b9df1aec4563663` | `a3aa5bc24fefbb0b4badfab729c06427b4b0ce765123e3f00fa14b14b9abc3bd` | 1 |
| 8 | `task_identifier` | `04bc2c4f5c193b04b1546fc960924466d183ba1a097e7b1bc9e3cab6c0198e04` | `8e46f37df2d84666de049a50878718f1f9c5c16ab01137c0aa8a818dd28ddba6` | 1 |
| 8 | `task_identifier` | `e7f5818cd66f7f1b588af181ba6fb40f70bc3c0044dcdfccb549e16eebfd4dab` | `1a2735f322c20ac87aff60d7bd8d3ddc77a832c4c9b12ee03ed58627b0682087` | 1 |
| 8 | `task_identifier` | `7a4faf23ae98b46cc64e2589f3ddafb1ffc4eaebd8e19194e0e2ebfaba8ede35` | `695314853618776b5b0a3877cca8db434410529c4194342d97be2aec286e5000` | 1 |
| 8 | `business_record_lookup` | `fb7117ee15dfc963ed4dd625448f546d6da70caad849b355bed19fcad37f2dd0` | `ef7b0894a17194c49f0297f93261c9ea683401491190ea4f95b8c25207fefe09` | 1 |
| 9 | `task_identifier` | `63b87ac44195b277afdaf6beb8c343dfa4538d8ea7b45f396b40fd820c259cbb` | `a1511d2d55439021a076f38d9fbadb6e7e62ab2c8de2cc397cf551d35db4170f` | 1 |
| 9 | `task_identifier` | `6fa0613d394c6b0af44d55b3d6a9cd36d854d25e1f138288d9be580540ec84bd` | `554553b6245f82747697f1805722703dfbb34e5984c3e68549375cfb8806891d` | 1 |
| 9 | `task_identifier` | `0588e9ec66d49762de82430ddfc0dce302e7b43e3a92cfb86e7406bc4755ac0c` | `f7956717bcf6cb21e3bc97f761e8d6186b20ec53ba23e6125abbe6f5781d9a6a` | 1 |
| 9 | `business_binding` | `6ac28185e2941f5eeed915f8adf37756130dfe89d5b1e13b348c1a6ad189dab1` | `658a0bd52c24731bf1c515d9a031f1dce7ee6d07cca23bfecc7a440b24c6b88f` | 1 |
| 9 | `business_binding` | `ce4717fd231a1c59a35d6b5e84272018709f0a3d63768425a2b4bacb9d078a1d` | `ab0bab4846d77f0dcd55afc3b8373d08c4139404bed1502985a15468c9705b4c` | 1 |
| 9 | `task_identifier` | `ff8e4f294bc73372913f16b39724d80047bbadeb84f3b46500ea5d97c546ebd0` | `5eee53f3f36c7468660f11a1b20873176e8f042556fdc569e73f7370dda00431` | 2 |
| 10 | `task_identifier` | `7220947c110a5ca838b7c4f90f70da5d9e32ffa3e5cc8530c7b6afb1aff7a021` | `7cf584f46ff649ffe0d1e82a277996efe08d3f9e9f2f7292be50bcfcd9ec5344` | 1 |
| 10 | `task_identifier` | `4ae485e10b40b564d1915d0fa460830629df29426e9226495b5fa32ded694c28` | `d93c534b48e603eb39349eaf59eca199b16a444af4e08081e71e657b67ab99b8` | 1 |
| 10 | `task_identifier` | `7bbb0517d7e32ea51c86f6ce4e32c4d8c7899c21e89df8e353fb4a75f4f9b31d` | `12739a6e74a00dd83e2206acfeb3ae1bf72ad4655ae7c76887aea18edb135160` | 1 |
| 10 | `task_identifier` | `8d29c1fbeccb326af832a6e5d80030a844a10840b84594809ef16e91d5832aff` | `7d54526a6c634c3d2b3b289904709ee614871916f8317981809814ad3cae66e2` | 1 |
| 10 | `task_identifier` | `1fec25d3cd121145566340c3541fb4985d7b88244cac46d0d31d439cc09bb3a1` | `91b8c53938e1f958e1b846dcf94ad562f4fe6ffb98210911ee35a8c9ceb985bd` | 1 |
| 10 | `business_record_lookup` | `ada7798810887fd394ea989506330921e4029a2818f921d7169598222253dedd` | `7a96c22c819fa60562a6c9e18fd8536cb3d0e1fc7cc0e284e253a0caab90eb58` | 1 |
| 11 | `task_identifier` | `3fd01ceeede9adbb7d18b9ecd600d56f9a17c00418b74f7fab716a52eb55ecfa` | `f073f364033353b60d3ed0fd0a6a762df5fa64c3f51525f37d07bea7aa32db2d` | 1 |
| 11 | `task_identifier` | `af6752b5d96f8759724d6b33cccaa8e6657a57dd131976bec4f2a0605be03101` | `8dfb6b825ba8cc516254878049c0ea08c4d7ab256c12fc46c6218fdb1b7ee80b` | 1 |
| 11 | `task_identifier` | `f8fff7e086a66451428f031fbbfd5446bff3339587db191c8e04b2d70f22a058` | `f34aa0ed76ac2db0fe5a0e82e770ebb6bf63df48199605169706391535124106` | 1 |
| 11 | `business_binding` | `aab478542a736b3affab7f5b202d3130bad4d5f2544dad2eb7a2cf45a5624323` | `bca5e61de3b1764438e70f5657e4d9699eb9b97b7027b287c33dbb8ad83fb90c` | 1 |
| 11 | `business_binding` | `b3c2d0cbacd62ade50e006cd3b030ffcbe54b74f59009372e9e28d620c1f208a` | `78099875056b02192c601126bf2e52b401d4ceeec43348ed1fa3c382dd70eb21` | 1 |
| 11 | `task_identifier` | `7f0dcc45ba5f1486a86d79c1d3a48fba082ce6ddace3eaa40af054051006e5a6` | `15c0737020b48301ef1f5b137ae2dd3a1eeb5459a57b064dd2423f415188716b` | 4 |
| 12 | `task_identifier` | `b4b36d6f34eb8c6e5f391808651c63fc3220fe5ec54c29191b7566ad45dc3614` | `d78bd341eb855b662b04a5a7367c2760713cf310a40b437313e8c7a4a0ea9e9e` | 1 |
| 12 | `task_identifier` | `bc235d2cc37db31fde409cfda8c8d83b7f53607b822685f470c064115ef277e1` | `1154cbd969f4ab2e4cccf71fb7f41473ba4d8ed05b7bca691178b0a6f77b85d2` | 1 |
| 12 | `task_identifier` | `b47a1057fb48b4655ca14aaee8d81df14030d393e330a40f01a56783f50228b5` | `e6c43a490ed0501f35eca4fa1a9f01a9ab9690e6e419570a8c2ced83d450b365` | 1 |
| 12 | `task_identifier` | `f25a0af25420e04724f1bac9d40943cace61f7771385b2d1f7bd8c53b5721519` | `b4c7fcc0d74358071fe5a14274d7470a985ec003794254083343e5ec04646610` | 1 |
| 13 | `task_identifier` | `240b2cd823a517719c84c2cd3c8f40f80e4f3080de0e9bb0e342e770f856a3b1` | `4484c394a7b283bae5fdc0f5996a3f7a2206ad454864c0764d2b5866a6104b05` | 1 |
| 13 | `task_identifier` | `20aa39f6e38259163df44ff0fcb76c2c146f6065e94b85363e11a0bdf180aa6e` | `7c8e99dcbceb04e511241222af53fc522f24f82b6bdb58e562dd9fda542e0167` | 1 |
| 13 | `task_identifier` | `266ffc065087af0ffbb962bec65d164781e9f65d3eff210946441c07dcfd17f5` | `c6f19d429f9f951c9570bdb781126c8f7fa78bbfa587b6e59bd41ae8d264f654` | 1 |
| 13 | `business_binding` | `5ebf4eb6358ed25775e682e56602dba3b8e8086efb45734efdf2041a2b97bf70` | `6454dda218b95919456526180db73a97488d16b4e15f43c27731f83cde424cd3` | 1 |
| 13 | `business_binding` | `eba58da6a7ee6048bfbf95f396e7811ae3d4df014ffcf1f1ed69ec5edbc60b3a` | `63124f228c739e2c0f728d6eb2fcff9fa97d5a8443032429953956b66b51b941` | 1 |
| 13 | `business_binding` | `b5a05d964d19f2750fb22a37fbf116ae2f433b125c06a674fb7dc56536356146` | `bde1c5b4ae852da16a68219af90ec785219ff7e133651fa64e81114c117ae436` | 1 |
| 13 | `business_binding` | `bc4914500281d958e58938a3b3e64ca77dcb92ef240e7a14bf03f834dc366958` | `4e64b6cab086971fe9379e8b0503969c306bdf127c60e87153fc3d2bc9b3c8cc` | 1 |
| 13 | `task_identifier` | `8db8d6392448111f60d4d9a8e8552a0190b40fe3363dea724feca0f0b29a05fb` | `f85abecfd96751e65f13ae3b29cb48575c298cae891237a9c6f112bdae9dbfaa` | 1 |
| 13 | `task_identifier` | `4f6827af03f0ff585dfdebc4f6d9710bb29ca985a44f103234b7f9387e68a391` | `0ea534bf4f99c4049ba241b0c0a9cf347f4e9f847532f3daefb47a471bccffcf` | 2 |
| 13 | `task_identifier` | `9f51aeb969203318e73ccbca0b28deb7976be2e989493931bb97a336002021ae` | `cd7dd6dfc968f641d7b81aa1f36aa551ff5865c12b79fae6de5391b0401cc4b2` | 1 |
| 13 | `business_record_lookup` | `3db18226cb7c5b021e3ae8f938a0b2d5a2c8a6cbaeb0580e35f44e3f4259bc33` | `a5c79779e4aabf1e2be5107eec9f3464e7d0adba8b82ce74937a343301644697` | 1 |
| 13 | `business_record_lookup` | `47c894de005bde527187d4c99e0b4fd5f81f96b6d06801507e07e43fcc348d0b` | `3b109e5e7d79c83cb1c7846b7a2fe5762887bbdb212a6c69a3f7c1cbe4b9ed2a` | 1 |
| 13 | `task_identifier` | `348e4985a4bb92d74ccee668e885ab0375622ded419badc0adcfb12ace4d529b` | `f76f0c55f556c0c9d3e3c6a3c61b60814004c8c45e86b091709336fcff313588` | 1 |
| 13 | `task_identifier` | `911fc1faa477475e47189beaa6a8ef5a8fe7938d93ebf7ee3088fd7ca53efd0a` | `70a46232c281dcb53080f34632ee2a2505522bd780453bad0b209d7bc7ea4ae6` | 1 |
| 13 | `task_identifier` | `9895d059389a5feb954406c16b7332afca912e45848cf4bf36b83e71a97a25a7` | `6216bc7ee0cbd957c0474231b79907d92bcd3af230dbf6b5a56b59af18e21662` | 1 |
| 14 | `task_identifier` | `894b27691da88a7ba3a67b95a0037d169bbd568f3b9db0f0852025719098274b` | `61450d24808b7c939f5960a628e1e16f75fef381bfacffd4d704a1668421cafc` | 1 |
| 14 | `task_identifier` | `b072e92e873e73dd4fca6ecd53f04da113519f7849a12c96ad404c71759ee736` | `b6c964b34acd4567ab86e673948927800758cd2d4da7518b07f723b2f6ef7ec7` | 1 |
| 14 | `task_identifier` | `ce25dcc2e2c53a8257248c415d2d348310bf2b132d2f0cf4b69f6d83e0ec6e57` | `1ebbb2edeb48089b2980233f10132d1971b4edafe91d9404cdb3d2dac972771e` | 1 |
| 14 | `task_identifier` | `b29008f9f52359d7d97902f86d1b8a1336414bdea4a23dff107f787af7b80f23` | `fa36450ee542449f1e0b28c79784bc29c26b330a3b9fc16bc078c5d6f481b7e4` | 1 |
| 14 | `task_identifier` | `ec2de579b2c13f5b895eb3741d63df0a63d293495e09ea9dd981df6826e0cca4` | `486ba05f967b734d838e890d2243a8a16d421d55ddd7fc8c967637d69614d363` | 1 |
| 14 | `business_binding` | `b3cca24e15e5e86a9f512da270543bccb122396ba2cc923327ecc94f4e418ea3` | `caba4accb6fcaae3a28669e88057766d3e070358459ae48608b71edc8a4a7504` | 1 |
| 14 | `business_binding` | `8c10c0e2532dc98f8f7f89687213ae8629f14b0428b8e02ff45cb4afbc59acd2` | `2228b52e9a23aeb89a496f8785154278a9431a2730c914959e005113eafd7b2b` | 1 |
| 14 | `task_identifier` | `b71add4df1c11f110c06cb23cf3e5469b932bd69d7d8725c5ae6255ef00b8058` | `a96d3b6c0fc86f74cf9b16f06ecfc0f58c42f3349c2fd1389176f43df27229ca` | 1 |
| 14 | `business_record_lookup` | `db91daa47bd5738fdc00724bc00009bd337837ee8ab5261fbeacd8c3a6f8f916` | `2085fbaf7d1b33177ab3ee261c0a4683892681803d75c7ec1d5b1ca83be0e571` | 1 |
| 15 | `task_identifier` | `ca0415708385dd23a67f0fe8dc24e3d123cd0a4e344ce2ead4aba0bbd369c843` | `c03ecb9c7096165b17631dabb170b472d3f508738f74b0004c772ae877505294` | 1 |
| 15 | `task_identifier` | `79a51ccddb5264a416e6cd602369005db5deef28df00ea28d422e77eb68a6fc4` | `44b0900b94586656f93aac35d8c09d8bab227818b70556c5277b3db9a53fb211` | 1 |
| 15 | `business_binding` | `e3a05bd4b414831508cae0080f4cb526687f9d5dcc3cfe2de8ea0df2a2b73afc` | `a85c9380750bcf1276ea64f1130ae3b64870485763b3846655af4af0d0fa2ea2` | 1 |
| 15 | `business_binding` | `a937b77d36890324a7112f150ba7cab7fffc22df26ad18ce845875db3a9b838c` | `6749cb86dee4f9bf83757734598202172c1480450367d4923577623c4f1f8bf0` | 1 |
| 15 | `business_binding` | `4b572f8bb608e4fa6b5913710d2cb608005ac8cdde93e039ec515344b64fb233` | `2f232c72fba1379d448c5eb9295d5b16fb079fdf6488c1e87c9a657634f761e7` | 1 |
| 15 | `business_binding` | `8e5f68d9806061d2a7529f665d6500b0275c18441de81af0e0a130e1ca473c4c` | `7dfe9495346c9bc7b305b9bb3126660bc1c9ec43c6a83ab55806faa44c18ba4f` | 1 |
| 15 | `task_identifier` | `d282bd9e1e72d95517ee1d4a347f10207d988120adba05e756c18b270360349d` | `4704b3b149cea10227cb9143d55f4038035f1cbffc8036ced86c131e3b115b8d` | 1 |
| 15 | `task_identifier` | `fcbf4373f2458d57acc00db173aca6e4ade31e1577f2f730757b7b9fbc627888` | `58402bc7ebddea49001f75aace0697e356fef4f3d9a1a087ea8c5177e8b0bad4` | 2 |
| 16 | `task_identifier` | `ae04bd9c2831a4c613d21aea37396d45749b0ed976b8619c858fd599a05c425d` | `36aa6176bd4b8a7ff37d8f8a70f6d63496b3c14b4fbd20bc8f978bf68bf1157e` | 1 |
| 16 | `task_identifier` | `c77e3f3c7b19ffef976c2bd13ca6bc34c26a3ade24e5635fa8575beb2b3f3f2c` | `7556a55f6d661a1ea006e21cfe241e30764e52ed15fc3709ccf0d9bbc0473873` | 1 |
| 16 | `business_binding` | `ead101bdb60f4d6b60293348be08080ebd877d549d966f77d40b55b3e0e1117b` | `2d8c57dc3092a7efc88705253c58c79193dde67515830361162b648ef25e2ac6` | 1 |
| 16 | `business_binding` | `260b3086b0a417e5a6953fe5be42d4fafd7739b761d98c2fb97001fbea0742a5` | `69ef737cda67e4f968ef3bd5cc5e634b51f22acf72051974bb745d8795ac355d` | 1 |
| 16 | `task_identifier` | `ee7db97480df09b4380801306172b604eef45b2f88e020c6f36e3766d191eeec` | `fe5443a3904fe133ef6ac4a5436c4bcf0ac03a4bfca99f7dc69f6d9afebb60e0` | 1 |
| 16 | `task_identifier` | `c7008ebeab43402a66787e5250fe5b53f259f034f423d8309fe195698831420b` | `7abf9017da1206256d9ec669cad66ea8718c0e8c358efacb4cbbcc3d0b9da96c` | 1 |
| 16 | `business_comparison` | `7ccced13e0218e46b16a107b080511c030c6baf7fd85c3f995ec2ab24751d7cd` | `38d69ed62e147d575dcf1d250724c9e1a6026df0c453428c6e860a89c55a445d` | 1 |

## Owner decision requested

Approve the LOCK/QAR/ARCH/RISK above for local implementation of the strict two-stage validator and exact 102-pair/16-source transition, preserving the 64 KiB artifact cap and all existing publication guards? Approval authorizes preparation and tests only. Public push/PR, merge, deployment, activation and live publication require their applicable concrete release authorization. Until the separately trusted transition and exact integration pass all checks, release remains blocked.
