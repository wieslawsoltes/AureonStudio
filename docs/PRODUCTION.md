# Production workflows — v0.3.0

These are integrated development workflows, not claims of complete production-DCC parity. Save the native `.aureon` document before portable export. [FEATURES.md](FEATURES.md) records supported algorithms, budgets and format limits.

## Modeling, UVs and painting

Select a closed solid and open **Model → Segmented bevel**. Width, segment count, profile and all/sharp selection create an evaluated modifier. Invalid overlapping widths reject without committing the draft. Explicit edge pairs/weights are available in modifier data. **Model → Exact solid Boolean** combines a selected solid with an operand, retaining an editable result and hiding the operand through a history transaction.

**Model → Pack UDIM islands** unwraps seam-separated charts and packs them into selected tile numbers. One UV set is retained. **Render → Texture painting** edits a draft layered UDIM texture. Brush/erase, layer controls and local undo/redo affect actual texels. Apply stores and assigns the asset; Cancel discards it. Scene undo/redo then covers the complete committed texture. Uploaded layers share a configured resolution and device-memory budget; this is not virtual-texture streaming.

## Controllers, constraints and retargeting

**Animation → Transform controllers** edits curve, oscillator, driver and bounded-expression data. Expressions are structured arithmetic, not executable JavaScript. **Animation → Constraint stack** adds ordered world-space copy, parent, aim, limit, path and blended-parent constraints. Targets and dependency cycles are validated before committing; invalid drafts remain editable. Some advanced parameters are JSON fields rather than dedicated graphical controls.

For **Animation → Retarget animation**, select a rigged target and provide a second rigged source. Review the proposed target-to-source bone mapping, frame range, sampling step and optional root-motion scale. Applying bakes target keys without replacing its skin weights or inverse binds. Retargeting is not an automatic production character-rig system.

## Shared dynamics and grooming

**Animation → Scene dynamics** attaches shared-world rigid bodies, cloth, or mesh-collider roles. Rigid shapes are sphere/convex; mass, initial velocity, friction and restitution are editable. Cloth has thickness, self-contact and pins. Attached rigid objects now collide with one another. Scrubbing evaluates the actual scene simulation rather than independent rigid-object worlds.

**Create → Particle fluid** creates a bounded CPU position-based fluid block with particle spacing, viscosity, vorticity and surface resolution. The viewport and renderer consume the reconstructed mesh. Use modest counts and save before large simulations. General concave dynamic-body and fully coupled fluid/cloth interaction remain incomplete.

Create hair on a source object, select its hair object, and open **Animation → Groom hair guides**. Brushes modify root-bound guides with local undo/redo; applying commits the groom. **Render → Fiber scattering** edits its material's cylindrical scattering controls. Hair remains tessellated strand geometry, not analytic curve intersections or a complete strand-collision solver.

## Media and rendering

**Render → Volume regions** edits homogeneous, dense or sparse density regions. The sparse-cloud action creates native 8-cubed density blocks. Imported density grids are validated JSON in the native layout, not `.vdb` files. Priority replacement regions can displace lower-priority density even where their sampled density is zero. Nested solid interiors are tracked separately. Region count, nesting and null-collision work are bounded with explicit diagnostics.

The existing material graph, bitmap and subsurface dialogs remain. Graph connectivity compiles to specialized WGSL; editing constants reuses compatible pipelines. Production settings expose path, photon and final-gather modes, density radius/count, denoising and AOVs. Photon estimates remain biased at finite settings.

**Render → Render frame / motion blur…** evaluates scene and camera data at shutter times. **Resume interactive viewport**, a scene edit or timeline interaction restores the interactive renderer. Never infer physical-GPU speed from software-adapter test timings.

## EXR and interchange

After rendering at least one path-traced sample, **Export compressed OpenEXR** selects NONE/ZIP/ZIPS, single-part or beauty/guides multipart layout, and FLOAT/HALF precision. Object IDs remain UINT. HALF overflow rejects explicitly. The exporter reads actual render data; PNG remains display-mapped and PFM remains unclamped linear RGB. Deep/tiled EXR are not implemented.

**File → Production interchange…** handles the documented GLB/glTF and ASCII PLY subsets and exports evaluated USDA mesh snapshots. Choose external glTF companion files together. Keep the native scene for richer materials, modifiers, controllers and simulation. Full USD composition/import, FBX, Alembic, OpenVDB `.vdb`, `.max` and `.mi` are not integrated.

## Durable distributed coordinator

```sh
npm run render:server
```

The coordinator prints its local URL and token. The editor's **Distributed rendering…** workspace submits jobs; browser workers run the same renderer. A stopped worker's unfinished lease can be reassigned. Stop finishes the current tile rather than interrupting a dispatch. Inspect completed task counts before downloading the merged EXR.

Durability is enabled by default. Acknowledged tiles survive restart in `.aureon-render-state/`; unfinished leases become pending and stale uploads reject. Configure another directory with `RENDER_STATE_DIR`, or use `RENDER_EPHEMERAL=1` for disposable in-memory jobs. Do not modify a live state directory or run two writers against it. Keep it outside public/static roots and out of version control. Persistence is single-writer Node/V8 state, not a cross-version archival format.

```sh
RENDER_HOST=127.0.0.1 RENDER_PORT=4183 \
RENDER_TOKEN='replace-with-a-long-random-secret' \
RENDER_STATE_DIR='/private/path/aureon-jobs' \
RENDER_ORIGINS='http://localhost:4173,http://127.0.0.1:4173' \
node scripts/render-server.mjs
```

For remote workers use trusted HTTPS termination, an explicit origin allowlist, a strong token and deliberate network access controls. Pages does not host this Node service or provision compute. `RENDER_MEMORY_MIB` controls the coordinator accumulation budget independently of tile GPU limits. HTTP/SIGKILL recovery is tested; multi-machine rendering throughput and every network/storage failure are not certified.
