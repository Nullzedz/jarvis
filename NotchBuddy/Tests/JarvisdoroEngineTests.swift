import Foundation

// Standalone checks for JarvisdoroEngine. Not part of the app target.
//   swiftc -parse-as-library -o /tmp/jarvisdoro-engine-tests \
//     NotchBuddy/Sources/App/JarvisdoroEngine.swift NotchBuddy/Tests/JarvisdoroEngineTests.swift \
//     && /tmp/jarvisdoro-engine-tests

@main
struct JarvisdoroEngineTests {
    static func main() {
        var failed = 0
        func check(_ label: String, _ ok: Bool, _ detail: String = "") {
            if ok {
                print("  ✓ \(label)")
            } else {
                failed += 1
                print("  ✗ \(label) \(detail)")
            }
        }

        let work = 25.0 * 60
        let rest = 5.0 * 60
        let config = JarvisdoroConfig(work: work, rest: rest)
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)

        // Defaults and clamps. Work and rest are each every minute from 1 through 60.
        check("defaults", JarvisdoroSettings.defaultWork == 25 && JarvisdoroSettings.defaultRest == 5)
        check("clamp work", JarvisdoroSettings.clampWork(0) == 1 && JarvisdoroSettings.clampWork(999) == 60)
        check("work is 1 through 60", (1...60).allSatisfy { JarvisdoroSettings.clampWork($0) == $0 }
              && JarvisdoroSettings.clampWork(61) == 60 && JarvisdoroSettings.clampWork(180) == 60)
        check("clamp rest", JarvisdoroSettings.clampRest(0) == 1 && JarvisdoroSettings.clampRest(90) == 60)
        check("rest is 1 through 60", (1...60).allSatisfy { JarvisdoroSettings.clampRest($0) == $0 }
              && JarvisdoroSettings.clampRest(61) == 60)
        check("clock", JarvisdoroEngine.clock(1500) == "25:00" && JarvisdoroEngine.clock(90) == "01:30"
              && JarvisdoroEngine.clock(0) == "00:00" && JarvisdoroEngine.clock(6000) == "100:00")

        // A phase runs until its deadline, then the next phase is announced once.
        var (snap, events) = JarvisdoroEngine.start(config: config, now: t0)
        check("start is work", snap.phase == .work && snap.deadline == t0.addingTimeInterval(work))
        check("start event", events == [.workStarts])
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(work - 1))
        check("work runs until its deadline", events.isEmpty && snap.phase == .work
              && JarvisdoroEngine.remaining(snap, now: t0.addingTimeInterval(work - 1)) == 1)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(work))
        check("rest starts once", events == [.restStarts] && snap.phase == .rest
              && snap.deadline == t0.addingTimeInterval(work + rest))
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(work + rest - 1))
        check("rest runs until its deadline", events.isEmpty && snap.phase == .rest
              && JarvisdoroEngine.remaining(snap, now: t0.addingTimeInterval(work + rest - 1)) == 1)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(work + rest))
        check("work starts once", events == [.workStarts] && snap.phase == .work)
        check("second work deadline", snap.deadline == t0.addingTimeInterval(work + rest + work))

        // A full hour, one tick a second: work, rest, work. Nothing in between.
        (snap, events) = JarvisdoroEngine.start(config: config, now: t0)
        for sec in 1...1800 {
            let (next, fired) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(TimeInterval(sec)))
            snap = next
            events.append(contentsOf: fired)
        }
        check("hour of events", events == [.workStarts, .restStarts, .workStarts], "\(events)")
        check("back on work", snap.phase == .work)
        check("hour lands on the second work", snap.deadline == t0.addingTimeInterval(work + rest + work),
              "\(snap.deadline?.timeIntervalSince(t0) ?? -1)")

        // Stop, then start, is a full work phase again.
        snap = JarvisdoroEngine.stop()
        check("stopped", snap.phase == .idle && snap.deadline == nil)
        let again = t0.addingTimeInterval(9999)
        (snap, events) = JarvisdoroEngine.start(config: config, now: again)
        check("restart from full work", snap.deadline == again.addingTimeInterval(work) && events == [.workStarts])

        // Pause freezes the remaining time. The clock does not move, and resume does not announce again.
        (snap, _) = JarvisdoroEngine.start(config: config, now: t0)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(24 * 60))
        check("quiet before the deadline", events.isEmpty && snap.phase == .work)
        let left = JarvisdoroEngine.remaining(snap, now: t0.addingTimeInterval(24 * 60))
        snap = JarvisdoroEngine.pause(snap, now: t0.addingTimeInterval(24 * 60))
        check("paused holds a minute", snap.paused && snap.pausedRemaining == 60 && left == 60)
        let (quiet, none) = JarvisdoroEngine.tick(snap, config: config, now: t0.addingTimeInterval(30 * 60))
        check("paused does not advance", quiet == snap && none.isEmpty)
        let later = t0.addingTimeInterval(40 * 60)
        snap = JarvisdoroEngine.resume(snap, now: later)
        check("resume keeps the minute", snap.deadline == later.addingTimeInterval(60) && snap.phase == .work)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: later.addingTimeInterval(10))
        check("resume does not announce again", events.isEmpty && snap.phase == .work)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: later.addingTimeInterval(60))
        check("paused minute still ends in rest", events == [.restStarts] && snap.phase == .rest)

        // Asleep across the boundary: land on the original schedule, one event.
        (snap, _) = JarvisdoroEngine.start(config: config, now: t0)
        let slept = t0.addingTimeInterval(40 * 60)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: slept)
        check("slept into second work", snap.phase == .work && events == [.workStarts], "\(events) \(snap.phase)")
        check("slept deadline", snap.deadline == t0.addingTimeInterval(25 * 60 + 5 * 60 + 25 * 60))
        check("slept remaining", JarvisdoroEngine.remaining(snap, now: slept) == 15 * 60)

        // Asleep near the end of rest: still rest, announced once, no extra event.
        (snap, _) = JarvisdoroEngine.start(config: config, now: t0)
        let nearRestEnd = t0.addingTimeInterval(25 * 60 + 5 * 60 - 30)
        (snap, events) = JarvisdoroEngine.tick(snap, config: config, now: nearRestEnd)
        check("slept into rest", events == [.restStarts], "\(events)")
        check("rest still running", snap.phase == .rest && JarvisdoroEngine.remaining(snap, now: nearRestEnd) == 30)

        // Lengths are minutes in UserDefaults: unset means the defaults, a saved value is clamped to 1…60.
        let ud = UserDefaults.standard
        func clearMinutes() {
            for key in [JarvisdoroSettings.workKey, JarvisdoroSettings.restKey] {
                ud.removeObject(forKey: key)
            }
        }
        clearMinutes()
        check("minutes unset", JarvisdoroSettings.workMinutes == 25 && JarvisdoroSettings.restMinutes == 5)
        ud.set(40, forKey: JarvisdoroSettings.workKey)
        ud.set(12, forKey: JarvisdoroSettings.restKey)
        check("saved minutes", JarvisdoroSettings.workMinutes == 40 && JarvisdoroSettings.restMinutes == 12)
        ud.set(180, forKey: JarvisdoroSettings.workKey)
        ud.set(0, forKey: JarvisdoroSettings.restKey)
        check("saved minutes clamp", JarvisdoroSettings.workMinutes == 60 && JarvisdoroSettings.restMinutes == 1)
        clearMinutes()
        check("pill id", JarvisdoroSettings.pillId == "integration_jarvisdoro")

        if failed > 0 {
            print("\(failed) failed")
            exit(1)
        }
        print("All Jarvisdoro engine checks passed")
    }
}
